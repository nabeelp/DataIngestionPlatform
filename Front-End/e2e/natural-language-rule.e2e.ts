import { expect, test, type Page, type Route } from '@playwright/test';

const GENERATED_CODE = `function validateRow(row: Row, rowNumber: number): string | null {
  const email = row['Email'];
  if (email === null || email === '') return null;
  return String(email).endsWith('@contoso.example') ? null : 'Email must end with @contoso.example';
}`;
const PSEUDOCODE = 'FOR EACH row:\n  IF Email is not empty AND does not end with "@contoso.example": report issue';

const generatedRule = {
  Id: 'rule-nl', FileDefinitionId: 'definition-id', Name: 'Contoso email', Description: 'Email must end with @contoso.example',
  RuleType: 'Natural Language', Severity: 'Error', ExecutionOrder: 2, SqlQuery: 'Email', IsEnabled: true,
  NaturalLanguageText: 'Email must end with @contoso.example', Pseudocode: PSEUDOCODE, GeneratedCode: GENERATED_CODE,
};
const mappedRule = {
  Id: 'rule-1', FileDefinitionId: 'definition-id', Name: 'Amount range', Description: '', RuleType: 'Range Check',
  Severity: 'Error', ExecutionOrder: 1, SqlQuery: 'Amount: 0..100', IsEnabled: true,
};
const ndjson = (events: object[]) => events.map(event => JSON.stringify(event)).join('\n') + '\n';

const signIn = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'header.payload.signature');
    localStorage.setItem('user', JSON.stringify({ id: 'admin', email: 'admin@example.com', Role: 'admin' }));
  });
};

/** Answers the page's supporting API calls; `naturalLanguage` handles the rule review. */
const mockApi = async (page: Page, naturalLanguage: (route: Route) => Promise<void>) => {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/rules/natural-language')) return naturalLanguage(route);
    let body: unknown = { success: true };
    if (path.endsWith('/definitions')) body = { success: true, definitions: [{ Id: 'definition-id', Name: 'Orders', Tables: [] }] };
    else if (path.endsWith('/admin/file-definitions')) body = { success: true, definitions: [{ id: 'definition-id', tables: [] }] };
    else if (path.endsWith('/rules/definitions/definition-id')) body = { success: true, rules: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
};

const openNaturalLanguageDrawer = async (page: Page) => {
  await page.goto('/admin/rules');
  await page.getByRole('button', { name: 'New Rule' }).click();
  await page.getByLabel('Evaluation Strategy').selectOption('Natural Language');
  await page.getByLabel('Rule to enforce').fill('Email must not end with microsoft.com');
};

test('a failed review shows the detailed reason and the activity leading up to it', async ({ page }) => {
  await signIn(page);
  await mockApi(page, route => route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson([
    { type: 'progress', level: 'info', message: 'Asking gpt-5.3-codex in Foundry project citadel-governance-project to review the rule (attempt 1 of 2)', elapsedMs: 30 },
    { type: 'progress', level: 'warning', message: 'The model reached its output limit of 16000 tokens before finishing the proposal. Retrying', elapsedMs: 61000 },
    { type: 'progress', level: 'error', message: 'The model reached its output limit of 16000 tokens before finishing the proposal (16000 output tokens, 15800 of them reasoning) [response resp_2]', elapsedMs: 122000 },
    { type: 'error', success: false, statusCode: 502, message: 'The model reached its output limit of 16000 tokens before finishing the proposal (16000 output tokens, 15800 of them reasoning) [response resp_2]' },
  ]) }));
  await openNaturalLanguageDrawer(page);
  await page.getByRole('button', { name: 'Review and create rule' }).click();

  const alert = page.getByRole('alert').first();
  await expect(alert).toContainText('Could not create the rule: The model reached its output limit of 16000 tokens before finishing the proposal (16000 output tokens, 15800 of them reasoning) [response resp_2]');
  const log = page.getByRole('log', { name: 'Rule review activity' });
  await expect(log.getByRole('listitem')).toHaveCount(4);
  await expect(log.getByRole('listitem').nth(2)).toContainText('Retrying');
  await expect(log.getByRole('listitem').nth(3)).toContainText('122.0 s');
  await expect(page.getByRole('button', { name: 'Review and create rule' })).toBeEnabled();
});

test('the admin sees a running timer and can stop a slow review', async ({ page }) => {
  await signIn(page);
  // The server never answers: the model is still thinking when the admin stops the review.
  await mockApi(page, async route => {
    await new Promise(resolve => setTimeout(resolve, 60_000));
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: '' }).catch(() => undefined);
  });
  await openNaturalLanguageDrawer(page);
  await page.getByRole('button', { name: 'Review and create rule' }).click();

  const running = page.getByRole('button', { name: /^Reviewing rule… \d+ s$/ });
  await expect(running).toBeDisabled();
  await expect(running).toHaveText(/Reviewing rule… [2-9] s/, { timeout: 10_000 });
  await expect(page.getByRole('log', { name: 'Rule review activity' })).toContainText('Sending the rule to the server');

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('log', { name: 'Rule review activity' })).toContainText('You stopped the review');
  await expect(page.getByRole('button', { name: 'Review and create rule' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('natural-language rules map to existing types or keep generated code, and are shown and edited safely', async ({ page }) => {
  const rules: object[] = [];
  const requests: string[] = [];
  const manualRules: Array<{ RuleType: string; SqlQuery: string }> = [];
  const updates: object[] = [];
  const regenerations: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('token', 'header.payload.signature');
    localStorage.setItem('user', JSON.stringify({ id: 'admin', email: 'admin@example.com', Role: 'admin' }));
  });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let body: unknown = { success: true };
    let status = 200;
    if (path.endsWith('/definitions') && method === 'GET') {
      body = { success: true, definitions: [{ Id: 'definition-id', Name: 'Orders', Tables: [] }] };
    } else if (path.endsWith('/admin/file-definitions')) {
      body = { success: true, definitions: [{ id: 'definition-id', tables: [] }] };
    } else if (path.endsWith('/rules/definitions/definition-id')) {
      body = { success: true, rules };
    } else if (path.endsWith('/rules/natural-language')) {
      const { Request } = route.request().postDataJSON() as { Request: string };
      requests.push(Request);
      let result: object;
      if (Request.startsWith('Customer')) {
        result = { success: true, outcome: 'rejected', reason: 'It needs data from another system.' };
      } else if (Request.startsWith('Amount')) {
        rules.push(mappedRule);
        result = { success: true, outcome: 'mapped', reason: 'An inclusive range expresses this exactly.', rule: mappedRule, pseudocode: 'IF Amount outside 0..100: report issue' };
      } else {
        rules.push(generatedRule);
        result = { success: true, outcome: 'natural_language', reason: 'No existing type checks a text suffix.', rule: generatedRule, pseudocode: PSEUDOCODE, typescript: GENERATED_CODE };
      }
      // The review streams its activity as NDJSON, ending with the result.
      await route.fulfill({ status: 200, contentType: 'application/x-ndjson; charset=utf-8', body: ndjson([
        { type: 'progress', level: 'info', message: 'Asking gpt-5.3-codex in Foundry project citadel-governance-project to review the rule (attempt 1 of 2)', elapsedMs: 40 },
        { type: 'progress', level: 'info', message: 'The model is still reasoning about the rule (5.0 s)', elapsedMs: 5040 },
        { type: 'progress', level: 'success', message: 'Saved draft rule', elapsedMs: 9100 },
        { type: 'result', ...result },
      ]) });
      return;
    } else if (path.endsWith('/rules') && method === 'POST') {
      manualRules.push(route.request().postDataJSON());
      status = 201;
      body = { success: true, rule: { Name: 'Manual range' } };
    } else if (path.endsWith('/rules/rule-nl/regenerate') && method === 'POST') {
      const { Request } = route.request().postDataJSON() as { Request: string };
      regenerations.push(Request);
      generatedRule.NaturalLanguageText = Request;
      generatedRule.Description = Request;
      body = {
        success: true,
        outcome: 'natural_language',
        reason: 'The revised request still needs generated code.',
        rule: generatedRule,
        pseudocode: PSEUDOCODE,
        typescript: GENERATED_CODE,
      };
    } else if (path.endsWith('/rules/rule-nl') && method === 'PUT') {
      updates.push(route.request().postDataJSON());
      body = { success: true, rule: generatedRule };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/admin/rules');
  await page.getByRole('button', { name: 'New Rule' }).click();
  const strategy = page.getByLabel('Evaluation Strategy');
  await expect(strategy).toHaveValue('Schema Validation');
  await strategy.selectOption('Natural Language');
  await expect(page.getByLabel('Rule Expression')).toHaveCount(0);
  const requestBox = page.getByLabel('Rule to enforce');
  const submit = page.getByRole('button', { name: 'Review and create rule' });
  await expect(submit).toBeDisabled();

  // Rejected: explained, nothing created, can retry.
  await requestBox.fill('Customer must exist in the CRM');
  await submit.click();
  await expect(page.getByRole('status')).toContainText('Cannot create rule: It needs data from another system.');
  await expect(submit).toBeEnabled();
  const log = page.getByRole('log', { name: 'Rule review activity' });
  await expect(log).toContainText('Sending the rule to the server');
  await expect(log).toContainText('5.0 s');
  await expect(log).toContainText('The model is still reasoning about the rule (5.0 s)');

  // Mapped without loss to an existing type.
  await requestBox.fill('Amount must be between 0 and 100');
  await submit.click();
  await expect(page.getByRole('status')).toContainText('Created draft rule "Amount range" as Numeric range: Amount: 0..100');
  // Once saved, the drawer moves on: Done or Create another, with the publish step pointed out.
  await expect(submit).toHaveCount(0);
  await expect(requestBox).toBeDisabled();
  await expect(page.getByText('Next step: the rule is saved to the draft.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'File Definitions → Versions' }).last()).toHaveAttribute('href', '/admin/file-definitions');
  await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create another rule' }).click();
  await expect(requestBox).toBeEnabled();
  await expect(requestBox).toHaveValue('');
  await expect(page.getByRole('log', { name: 'Rule review activity' })).toHaveCount(0);
  await expect(submit).toBeDisabled();

  // Not mappable: kept as a Natural Language rule with pseudocode and TypeScript.
  await requestBox.fill('Email must end with @contoso.example');
  await submit.click();
  const created = page.getByRole('status');
  await expect(created).toContainText('Created draft Natural Language rule "Contoso email"');
  await expect(created.getByText(PSEUDOCODE.split('\n')[1].trim())).toBeVisible();
  await expect(created.getByLabel('TypeScript implementation')).toContainText('function validateRow');
  expect(requests).toEqual(['Customer must exist in the CRM', 'Amount must be between 0 and 100', 'Email must end with @contoso.example']);

  // Done closes the drawer; the list shows the original text, pseudocode and code of the generated rule.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'New Validation Rule' })).toHaveCount(0);
  const card = page.locator('div.p-5', { has: page.getByRole('heading', { name: 'Contoso email' }) });
  await expect(card).toContainText('Natural Language');
  await expect(card).toContainText('Columns read: Email');
  await expect(card.getByRole('blockquote')).toHaveText('Email must end with @contoso.example');
  await card.getByText('TypeScript implementation', { exact: true }).click();
  await expect(card.getByLabel('TypeScript implementation')).toContainText("endsWith('@contoso.example')");

  // Editing a generated rule allows its original request to be revised and safely regenerated.
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Rule Expression')).toHaveCount(0);
  await expect(page.getByLabel('Evaluation Strategy')).toHaveCount(0);
  const originalRequest = page.getByLabel('Original request');
  await expect(originalRequest).toHaveValue('Email must end with @contoso.example');
  await expect(page.getByRole('button', { name: 'Regenerate from request' })).toBeDisabled();
  await originalRequest.fill('Email must end with @contoso.example and be lowercase');
  await page.getByRole('button', { name: 'Regenerate from request' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Validation Rule' })).toHaveCount(0);
  expect(regenerations).toEqual(['Email must end with @contoso.example and be lowercase']);

  // Presentation-only updates remain available without another model call.
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByPlaceholder('e.g., Amount Cannot Be Negative').fill('Contoso email only');
  await page.getByRole('button', { name: 'Update Parameters' }).click();
  await expect.poll(() => updates).toEqual([{ Name: 'Contoso email only', Description: 'Email must end with @contoso.example and be lowercase', Severity: 'Error', ExecutionOrder: 2 }]);

  // Generated rules cannot be cloned into a manual rule.
  await card.getByRole('button').first().click();
  await expect(page.getByRole('button', { name: 'Clone Logic' })).toHaveCount(0);
  await page.locator('div.fixed.inset-0.z-10').click();

  // Manual rule creation is unchanged.
  await page.getByRole('button', { name: 'New Rule' }).click();
  await page.getByLabel('Evaluation Strategy').selectOption('Range Check');
  await page.getByPlaceholder('e.g., Amount Cannot Be Negative').fill('Manual range');
  await page.getByLabel('Rule Expression').fill('Amount: 0..50');
  await page.getByRole('button', { name: 'Save Validation Rule' }).click();
  await expect.poll(() => manualRules).toMatchObject([{ RuleType: 'Range Check', SqlQuery: 'Amount: 0..50' }]);
});
