import { expect, test, type Page, type Route } from '@playwright/test';

const generatedConfig = {
  id: 'rule-nl',
  name: 'Contoso email',
  description: 'Emails must use the Contoso example domain.',
  severity: 'Error',
  executionOrder: 2,
  enabled: true,
  table: null,
  type: 'naturalLanguage',
  params: {
    request: 'Email must end with @contoso.example',
    explanation: 'Each non-empty Email value must use the approved domain.',
    mode: 'row',
    failWhen: "NOT ENDS_WITH(Email, '@contoso.example')",
    query: null,
    message: 'Email must end with @contoso.example',
    columns: { '': ['Email'] },
    examples: [
      { table: '', values: { Email: 'person@contoso.example' }, expectedValid: true, source: 'model' },
      { table: '', values: { Email: 'person@example.org' }, expectedValid: false, source: 'model' },
    ],
    provenance: {
      model: 'test-model',
      responseId: 'response-123',
      promptSha256: 'a'.repeat(64),
      createdAt: '2026-01-01T00:00:00Z',
    },
  },
};
const mappedConfig = {
  id: 'rule-1',
  name: 'Amount range',
  description: '',
  severity: 'Error',
  executionOrder: 1,
  enabled: true,
  table: null,
  type: 'range',
  params: { column: 'Amount', min: 0, max: 100, minInclusive: true, maxInclusive: true },
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
  await page.getByLabel('Evaluation Strategy').selectOption('naturalLanguage');
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

test('natural-language RuleConfigs show provenance and editable examples, and can be dry-run safely', async ({ page }) => {
  const rules: object[] = [];
  const requests: string[] = [];
  const manualRules: Array<{ Config: { type: string; params: Record<string, unknown> } }> = [];
  const updates: object[] = [];
  const exampleTests: Array<{ Config: { params: Record<string, unknown> }; examples: unknown[] }> = [];
  const dryRuns: string[] = [];
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
      body = {
        success: true,
        definitions: [{
          id: 'definition-id',
          tables: [],
          contract: { layout: 'single', tables: [{ sheet: null, columns: [{ name: 'Email' }, { name: 'Amount' }] }], lookups: {} },
        }],
      };
    } else if (path.endsWith('/rules/definitions/definition-id')) {
      body = { success: true, rules };
    } else if (path.endsWith('/rules/natural-language')) {
      const { Request } = route.request().postDataJSON() as { Request: string };
      requests.push(Request);
      let result: object;
      if (Request.startsWith('Customer')) {
        result = { success: true, outcome: 'rejected', reason: 'It needs data from another system.' };
      } else if (Request.startsWith('Amount')) {
        rules.push(mappedConfig);
        result = { success: true, outcome: 'mapped', reason: 'An inclusive range expresses this exactly.', config: mappedConfig };
      } else {
        rules.push(generatedConfig);
        result = { success: true, outcome: 'natural_language', reason: 'No existing type checks a text suffix.', config: generatedConfig };
      }
      // The review streams its activity as NDJSON, ending with the result.
      await route.fulfill({ status: 200, contentType: 'application/x-ndjson; charset=utf-8', body: ndjson([
        { type: 'progress', level: 'info', message: 'Asking gpt-5.3-codex in Foundry project citadel-governance-project to review the rule (attempt 1 of 2)', elapsedMs: 40 },
        { type: 'progress', level: 'info', message: 'The model is still reasoning about the rule (5.0 s)', elapsedMs: 5040 },
        { type: 'progress', level: 'success', message: 'Saved draft rule', elapsedMs: 9100 },
        { type: 'result', ...result },
      ]) });
      return;
    } else if (path.endsWith('/rules/validate')) {
      body = { ok: true, errors: [] };
    } else if (path.endsWith('/rules/test')) {
      const payload = route.request().postDataJSON() as { Config: { params: Record<string, unknown> }; examples: unknown[] };
      exampleTests.push(payload);
      body = {
        ok: true,
        errors: [],
        results: payload.examples.map((example, index) => ({
          index: index + 1,
          table: '',
          expectedValid: (example as { expectedValid: boolean }).expectedValid,
          actualValid: (example as { expectedValid: boolean }).expectedValid,
          passed: true,
          error: null,
        })),
      };
    } else if (path.endsWith('/uploads/recent')) {
      body = {
        success: true,
        uploads: [{
          Id: 'upload-dry-run',
          FileDefinitionId: 'definition-id',
          OriginalFilename: 'recent.csv',
          Status: 'VALIDATED',
        }],
      };
    } else if (path.endsWith('/uploads/upload-dry-run/dry-run') && method === 'POST') {
      dryRuns.push(path.split('/api/v1').pop() || path);
      body = { success: true, status: 'completed', structuralIssues: [], checks: [{ id: 'rule-nl', name: 'Contoso email', status: 'PASS', issueCount: 0 }] };
    } else if (path.endsWith('/rules') && method === 'POST') {
      manualRules.push(route.request().postDataJSON() as typeof manualRules[number]);
      status = 201;
      body = { success: true, rule: route.request().postDataJSON() };
    } else if (path.endsWith('/rules/rule-nl') && method === 'PUT') {
      updates.push(route.request().postDataJSON());
      body = { success: true, rule: generatedConfig };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/admin/rules');
  await page.getByRole('button', { name: 'New Rule' }).click();
  const strategy = page.getByLabel('Evaluation Strategy');
  await expect(strategy).toHaveValue('columnsPresent');
  await strategy.selectOption('naturalLanguage');
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
  await expect(page.getByRole('status')).toContainText('Created draft rule "Amount range" as Range Check: Amount: 0..100');
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

  // Not mappable to a built-in type: saved as a declarative Natural Language RuleConfig.
  await requestBox.fill('Email must end with @contoso.example');
  await submit.click();
  const created = page.getByRole('status').filter({ hasText: 'Created draft Natural Language rule' });
  await expect(created).toContainText('Created draft Natural Language rule "Contoso email"');
  await expect(created).toContainText('Rule explanation');
  await expect(created).toContainText('Validated SQL expression');
  await expect(created).toContainText('Model provenance');
  await expect(created).toContainText('response-123');
  await expect(created).toContainText('Validated examples (2)');
  expect(requests).toEqual(['Customer must exist in the CRM', 'Amount must be between 0 and 100', 'Email must end with @contoso.example']);

  await page.getByRole('button', { name: 'Review and edit examples' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Validation Rule' })).toBeVisible();
  await expect(page.getByLabel('Original request')).toHaveValue('Email must end with @contoso.example');
  await expect(page.getByLabel('Recent upload for dry run')).toHaveValue('upload-dry-run');
  await page.getByLabel('Example values as JSON').first().fill('{"Email":"reviewed@contoso.example"}');
  await page.getByRole('button', { name: 'Run examples' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'All 2 examples matched their expected result.' }))
    .toBeVisible();
  expect(exampleTests).toHaveLength(1);
  expect(exampleTests[0].examples[0]).toMatchObject({ values: { Email: 'reviewed@contoso.example' }, source: 'admin' });

  await page.getByRole('button', { name: 'Dry run' }).click();
  const dryRunStatus = page.getByRole('status').filter({ hasText: 'Preview status: completed' });
  await expect(dryRunStatus).toContainText('Contoso email: PASS (0 issue(s))');
  await expect(dryRunStatus).not.toContainText('reviewed@contoso.example');
  expect(dryRuns).toEqual(['/uploads/upload-dry-run/dry-run']);

  await page.getByPlaceholder('e.g., Amount Cannot Be Negative').fill('Contoso email only');
  await page.getByRole('button', { name: 'Update Rule' }).click();
  await expect.poll(() => updates).toHaveLength(1);
  const updatedConfig = (updates[0] as { Config: { name: string; params: { examples: Array<{ values: Record<string, string> }> } } }).Config;
  expect(updatedConfig.name).toBe('Contoso email only');
  expect(updatedConfig.params.examples[0].values).toEqual({ Email: 'reviewed@contoso.example' });

  // Manual rule authoring also uses typed parameters instead of expression text.
  await page.getByRole('button', { name: 'New Rule' }).click();
  await page.getByLabel('Evaluation Strategy').selectOption('range');
  await page.getByPlaceholder('e.g., Amount Cannot Be Negative').fill('Manual range');
  await page.getByLabel('Column').fill('Amount');
  await page.getByRole('spinbutton', { name: 'Minimum' }).fill('0');
  await page.getByRole('spinbutton', { name: 'Maximum' }).fill('50');
  await page.getByRole('button', { name: 'Save Validation Rule' }).click();
  await expect.poll(() => manualRules).toMatchObject([{ Config: { type: 'range', params: { column: 'Amount', min: 0, max: 50 } } }]);
});
