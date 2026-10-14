import { expect, test, type Page, type Route } from '@playwright/test';

// Drives the rules section of the file definition workspace with a mocked API, so the flows that matter
// (authoring, validation against the unsaved structure, saving with the definition, leaving with unsaved changes)
// run without a database or model.

const column = (name: string, type = 'string') => ({ name, type, mustExist: true, nullable: false });

const contract = {
  schemaVersion: 1,
  layout: 'single',
  ignoredSheets: [],
  encoding: 'auto',
  tables: [{
    sheet: null, headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null,
    columns: [column('Amount', 'decimal'), { ...column('Email'), mustExist: false, nullable: true }],
  }],
  rules: [],
  lookups: {},
};

const definition = {
  id: 'def-1',
  name: 'Orders',
  description: '',
  columns: [],
  tables: [],
  contract,
  status: 'Active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  activeVersion: { id: 'v1', versionNumber: 1, activatedAt: '2026-01-01T00:00:00Z' },
  hasUnpublishedChanges: false,
};

const rangeRule = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Amount range',
  description: '',
  severity: 'Error',
  executionOrder: 1,
  enabled: true,
  table: null,
  type: 'range',
  params: { column: 'Amount', min: 0, max: 100, minInclusive: true, maxInclusive: true },
};

const generatedRule = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Contoso email',
  description: 'Emails must use the Contoso example domain.',
  severity: 'Error',
  executionOrder: 1,
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
    provenance: { model: 'test-model', responseId: 'response-123', promptSha256: 'a'.repeat(64), createdAt: '2026-01-01T00:00:00Z' },
  },
};

const ndjson = (events: object[]) => events.map(event => JSON.stringify(event)).join('\n') + '\n';

interface Calls {
  saves: Array<Record<string, unknown>>;
  creates: Array<Record<string, unknown>>;
  publishes: number;
  proposals: Array<Record<string, unknown>>;
  validations: Array<Record<string, unknown>>;
}

interface MockOptions {
  rules?: object[];
  definition?: typeof definition;
  propose?: (route: Route, body: Record<string, unknown>) => Promise<void>;
  preflight?: (body: Record<string, unknown>) => object;
}

const mockApi = async (page: Page, options: MockOptions = {}): Promise<Calls> => {
  const calls: Calls = { saves: [], creates: [], publishes: 0, proposals: [], validations: [] };
  await page.addInitScript(() => {
    localStorage.setItem('token', 'header.payload.signature');
    localStorage.setItem('user', JSON.stringify({ id: 'admin', email: 'admin@example.com', Role: 'admin' }));
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, '');
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/admin/file-definitions' && method === 'GET') return json({ success: true, definitions: [options.definition ?? definition], total: 1 });
    if (path === '/admin/file-definitions' && method === 'POST') {
      calls.creates.push(request.postDataJSON());
      return json({ success: true, definition: { ...definition, id: 'def-new', name: 'New one' } }, 201);
    }
    if (path === '/admin/file-definitions/users/counts') return json({ success: true, counts: {} });
    if (path === '/admin/file-definitions/preflight') {
      return json({ success: true, ok: true, errors: [], diff: null, ...(options.preflight?.(request.postDataJSON()) ?? {}) });
    }
    if (path === '/admin/file-definitions/def-1' && method === 'PUT') {
      calls.saves.push(request.postDataJSON());
      return json({ success: true, definition, revision: 'rev-2' });
    }
    if (path === '/admin/file-definitions/def-1/versions' && method === 'POST') {
      calls.publishes += 1;
      return json({ success: true, version: { id: 'v2', versionNumber: 2 } });
    }
    if (path === '/rules/definitions/def-1') {
      return json({ success: true, rules: options.rules ?? [], published: false, versionNumber: null, revision: 'rev-1' });
    }
    if (path === '/rules/validate') {
      calls.validations.push(request.postDataJSON());
      return json({ success: true, ok: true, errors: [] });
    }
    if (path === '/rules/natural-language/propose') {
      const body = request.postDataJSON();
      calls.proposals.push(body);
      if (options.propose) return options.propose(route, body);
      return route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: ndjson([
          { type: 'progress', level: 'info', message: 'Asking test-model to review the rule (attempt 1 of 3)', elapsedMs: 40 },
          { type: 'progress', level: 'success', message: 'Proposed rule "Contoso email"', elapsedMs: 9100 },
          { type: 'result', success: true, outcome: 'natural_language', reason: 'No existing type checks a text suffix.', config: generatedRule },
        ]),
      });
    }
    if (path === '/lookups') return json({ success: true, lookups: [] });
    if (path === '/uploads/recent') return json({ success: true, uploads: [] });
    return json({ success: true });
  });
  return calls;
};

const openRules = async (page: Page) => {
  await page.goto('/admin/file-definitions/def-1/edit?step=rules');
  await expect(page.getByRole('heading', { name: 'Validation rules' })).toBeVisible();
};

test('a saved definition opens on its rules and lists them as readable sentences', async ({ page }) => {
  await mockApi(page, { rules: [rangeRule] });
  await openRules(page);

  const rule = page.getByRole('listitem', { name: 'Rule Amount range' });
  await expect(rule).toContainText('Amount must be between 0 and 100');
  await expect(page.getByRole('navigation', { name: 'Definition workspace' }).getByRole('button', { name: /Rules/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('1 rule · 1 active · 0 warnings')).toBeVisible();
});

test('adding and editing rules is buffered and saved with the definition', async ({ page }) => {
  const calls = await mockApi(page, { rules: [rangeRule] });
  await openRules(page);

  await page.getByRole('button', { name: 'Choose a rule type' }).click();
  const dialog = page.getByRole('dialog', { name: 'New rule' });
  await expect(dialog.getByText(/Header row/)).toHaveCount(0);
  const amountSummary = dialog.locator('li').filter({ hasText: 'Amount' });
  await expect(amountSummary).toContainText('decimal');
  await expect(amountSummary).toContainText('Required');
  const emailSummary = dialog.locator('li').filter({ hasText: 'Email' });
  await expect(emailSummary).toContainText('string');
  await expect(emailSummary).toContainText('Optional');
  const newRulePanel = page.locator('section[aria-label="New rule"]');
  const newRuleLabels = newRulePanel.locator('label');
  await expect(newRuleLabels.nth(0)).toContainText('Rule name');
  await expect(newRuleLabels.nth(1)).toContainText('Description');
  await expect(newRuleLabels.nth(2)).toContainText('When the check fails');
  await expect(newRuleLabels.nth(3)).toContainText('Rule type');
  // Required columns, required values and data types are column properties, not rule types.
  const ruleTypes = page.getByLabel('Rule type').locator('option');
  await expect(ruleTypes).not.toContainText(['Required values', 'Required columns', 'Data type']);
  const labels = await ruleTypes.allTextContents();
  expect(labels).toEqual([...labels].sort((left, right) => left.localeCompare(right)));
  await page.getByLabel('Rule type').selectOption('enum');
  await page.getByLabel('Rule name').fill('Allowed statuses');
  await page.getByLabel('Column', { exact: true }).selectOption('Email');
  await page.getByLabel('Allowed values (comma-separated)').fill('a, b');
  await expect(page.getByText('The rule is valid for this definition.')).toBeVisible();
  await page.getByRole('button', { name: 'Add rule' }).click();

  const added = page.getByRole('listitem', { name: 'Rule Allowed statuses' });
  await expect(added).toContainText('New');
  await expect(added).toContainText('Email must be one of: a, b');
  expect(calls.saves).toHaveLength(0);

  await page.getByRole('button', { name: 'Edit Amount range' }).click();
  const editRulePanel = page.locator('section[aria-label="Edit rule Amount range"]');
  const editRuleLabels = editRulePanel.locator('label');
  await expect(editRuleLabels.nth(0)).toContainText('Rule name');
  await expect(editRuleLabels.nth(1)).toContainText('Description');
  await expect(editRuleLabels.nth(2)).toContainText('When the check fails');
  await expect(editRuleLabels.nth(3)).toContainText('Rule type');
  await page.getByLabel('When the check fails').selectOption('Warning');
  await page.getByRole('button', { name: 'Update rule' }).click();
  await expect(page.getByRole('listitem', { name: 'Rule Amount range' })).toContainText('Changed');
  expect(calls.saves).toHaveLength(0);

  await page.getByRole('button', { name: 'Review & publish' }).click();
  await expect(page.getByRole('heading', { name: 'Review and publish' })).toBeVisible();
  await expect(page.getByText('Changes since the saved draft: 1 added, 1 changed, 0 removed.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish version 2' }).click();

  await expect.poll(() => calls.saves.length).toBe(1);
  const saved = calls.saves[0] as { rules: Array<{ name: string; severity: string }>; revision: string };
  expect(saved.revision).toBe('rev-1');
  expect(saved.rules.map(item => `${item.name}:${item.severity}`)).toEqual(['Amount range:Warning', 'Allowed statuses:Error']);
  await expect.poll(() => calls.publishes).toBe(1);
});

test('column fields are disabled until a sheet is selected and use only that sheet columns', async ({ page }) => {
  const sheetsDefinition = {
    ...definition,
    contract: {
      ...contract,
      layout: 'sheets' as const,
      tables: [
        {
          sheet: 'Orders', headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null,
          columns: [column('Order ID'), column('Amount', 'decimal')],
        },
        {
          sheet: 'Returns', headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null,
          columns: [column('Return ID'), column('Reason')],
        },
      ],
    },
  };
  await mockApi(page, { definition: sheetsDefinition });
  await openRules(page);

  await page.getByRole('button', { name: 'Choose a rule type' }).click();
  const columnField = page.getByLabel('Column', { exact: true });
  await expect(columnField).toBeDisabled();
  await expect(columnField).toHaveValue('');

  await page.getByLabel('Sheet').selectOption('Orders');
  await expect(columnField).toBeEnabled();
  await expect(columnField.locator('option')).toHaveText(['Choose a column', 'Order ID', 'Amount']);
  await columnField.selectOption('Amount');
  await page.getByLabel('Minimum result').fill('10');

  await page.getByLabel('Sheet').selectOption('Returns');
  await expect(columnField).toHaveValue('');
  await expect(page.getByLabel('Minimum result')).toHaveValue('10');
  await expect(columnField.locator('option')).toHaveText(['Choose a column', 'Return ID', 'Reason']);
});

test('describing a rule shows the review activity and only adds it to the draft once accepted', async ({ page }) => {
  const calls = await mockApi(page);
  await openRules(page);

  await page.getByRole('button', { name: 'Describe a rule' }).click();
  await page.getByLabel('Rule to enforce').fill('Email must end with @contoso.example');
  await page.getByRole('button', { name: 'Generate rule' }).click();

  const proposal = page.getByRole('status').filter({ hasText: 'Proposed rule "Contoso email"' });
  await expect(proposal).toContainText('Rule explanation');
  await expect(proposal).toContainText('Model provenance');
  await expect(page.getByRole('log', { name: 'Rule review activity' })).toContainText('Asking test-model');
  await expect(page.getByRole('listitem', { name: 'Rule Contoso email' })).toHaveCount(0);
  const sent = calls.proposals[0] as { Contract: { rules: unknown[] }; Rules: unknown[] };
  expect(sent.Contract.rules).toEqual([]);

  await proposal.getByRole('button', { name: 'Add to definition' }).click();
  await expect(page.getByRole('listitem', { name: 'Rule Contoso email' })).toContainText('New');
  expect(calls.saves).toHaveLength(0);
});

test('a rejected review explains why and leaves the draft alone', async ({ page }) => {
  await mockApi(page, {
    propose: route => route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: ndjson([{ type: 'result', success: true, outcome: 'rejected', reason: 'It needs data from another system.' }]),
    }),
  });
  await openRules(page);

  await page.getByRole('button', { name: 'Describe a rule' }).click();
  await page.getByLabel('Rule to enforce').fill('Customer must exist in the CRM');
  await page.getByRole('button', { name: 'Generate rule' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Cannot create rule' })).toContainText('It needs data from another system.');
  await expect(page.getByRole('button', { name: 'Generate rule' })).toBeEnabled();
  await expect(page.getByText('0 rules')).toBeVisible();
});

test('a slow review can be stopped', async ({ page }) => {
  await mockApi(page, {
    propose: async route => {
      await new Promise(resolve => setTimeout(resolve, 30_000));
      await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: '' }).catch(() => undefined);
    },
  });
  await openRules(page);

  await page.getByRole('button', { name: 'Describe a rule' }).click();
  await page.getByLabel('Rule to enforce').fill('Email must not end with microsoft.com');
  await page.getByRole('button', { name: 'Generate rule' }).click();
  await expect(page.getByRole('log', { name: 'Rule review activity' })).toContainText('Sending the rule to the server');

  await page.getByRole('button', { name: 'Stop generation' }).click();
  await expect(page.getByRole('log', { name: 'Rule review activity' })).toContainText('You stopped the review');
  await expect(page.getByRole('button', { name: 'Generate rule' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('renaming a column flags the rules that used it and blocks publishing until they are fixed', async ({ page }) => {
  const calls = await mockApi(page, { rules: [rangeRule] });
  await openRules(page);
  await expect(page.getByRole('listitem', { name: 'Rule Amount range' })).not.toContainText('Needs attention');

  await page.getByRole('navigation', { name: 'Definition workspace' }).getByRole('button', { name: 'Definition' }).click();
  await page.getByRole('list', { name: 'Definition setup steps' }).getByRole('button', { name: /Tables and columns/ }).click();
  await page.getByPlaceholder('Column name').first().fill('Total');
  await page.getByRole('list', { name: 'Definition setup steps' }).getByRole('button', { name: /Rules/ }).click();

  const rule = page.getByRole('listitem', { name: 'Rule Amount range' });
  await expect(rule).toContainText('Needs attention');
  await expect(rule).toContainText('Column "Amount" is no longer defined.');
  await expect(page.getByRole('alert').filter({ hasText: '1 rule needs attention' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review & publish' })).toBeEnabled();

  // Disabling the rule is a way out; so is pointing it at the renamed column.
  await rule.getByLabel('Disable Amount range').uncheck();
  await expect(page.getByRole('alert').filter({ hasText: 'needs attention' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
  expect(calls.saves).toHaveLength(0);
});

test('leaving with unsaved rule changes asks first, and cancel keeps the draft', async ({ page }) => {
  const calls = await mockApi(page, { rules: [rangeRule] });
  await openRules(page);

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete Amount range' }).click();
  await expect(page.getByRole('listitem', { name: 'Rule Amount range' })).toHaveCount(0);

  const dialogs: string[] = [];
  page.on('dialog', dialog => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.getByRole('link', { name: 'File Definitions' }).first().click();
  await expect.poll(() => dialogs.length).toBeGreaterThan(0);
  expect(dialogs.at(-1)).toContain('unsaved changes');
  await expect(page).toHaveURL(/\/admin\/file-definitions\/def-1\/edit/);
  await expect(page.getByText('0 rules')).toBeVisible();
  expect(calls.saves).toHaveLength(0);
});

test('a new definition can be created with its rules in one workspace', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/admin/file-definitions/new');
  const form = page.locator('form');
  await form.getByLabel('Name *').fill('New one');
  await form.getByRole('button', { name: /Start from a clean slate/ }).click();
  await form.getByRole('button', { name: 'Next' }).click();
  await form.getByPlaceholder('Column name').fill('Amount');
  await form.getByLabel('Data type for Amount').selectOption('decimal');
  await form.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Validation rules' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose a rule type' }).click();
  await page.getByLabel('Rule type').selectOption('range');
  await page.getByLabel('Rule name').fill('Amount range');
  await page.getByLabel('Column', { exact: true }).selectOption('Amount');
  await page.getByLabel('Minimum', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Add rule' }).click();
  await expect(page.getByRole('listitem', { name: 'Rule Amount range' })).toContainText('New');

  await form.getByRole('button', { name: 'Next' }).click();
  await expect(form.getByRole('heading', { name: 'Review and publish' })).toBeVisible();
  await expect(form.getByLabel('Review rules')).toContainText('1 rule');
  await form.getByRole('button', { name: 'Publish version 1' }).click();

  await expect.poll(() => calls.creates.length).toBe(1);
  const created = calls.creates[0] as { rules: Array<{ name: string; type: string; params: { column: string; min: number } }> };
  expect(created.rules).toHaveLength(1);
  expect(created.rules[0]).toMatchObject({ name: 'Amount range', type: 'range', params: { column: 'Amount', min: 0 } });
});
