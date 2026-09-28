import path from 'path';
import { fileURLToPath } from 'url';
import { expect, test, type Page } from '@playwright/test';

// Drives example-assisted definition creation: an admin proposes one table per sheet from a multi-sheet XLSX
// example (or a single table from a CSV example), reviews them and the suggested allowed-values and range rules,
// accepts a suggested rule, and uploads are then validated sheet by sheet against them.

const API_URL = process.env.E2E_API_URL || 'http://localhost:3000/api/v1';
const PASSWORD = 'password123';
const ADMIN = 'admin@company.com';
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const XLSX_EXAMPLE = path.join(FIXTURES, 'orders-example.xlsx');

const login = async (page: Page, email: string) => {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in with Email' }).click();
  await expect(page).not.toHaveURL(/\/login/);
};

const api = async (page: Page, method: string, apiPath: string, body?: unknown) => {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await page.request.fetch(`${API_URL}${apiPath}`, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
};

const createFromModal = async (page: Page): Promise<string> => {
  const [created] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/admin/file-definitions') && r.request().method() === 'POST'),
    page.locator('form').getByRole('button', { name: 'Create' }).click(),
  ]);
  const body = await created.json();
  expect(body.success).toBe(true);
  return body.definition.id;
};

const uploadFile = async (page: Page, definitionName: string, file: string | { name: string; mimeType: string; buffer: Buffer }) => {
  await page.goto('/admin/upload');
  await page.locator('select').first().selectOption({ label: definitionName });
  await page.locator('input[type="file"]').setInputFiles(file);
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/uploads') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Verify and Upload File' }).click(),
  ]);
  return { status: response.status(), body: await response.json() };
};

const uploadCsv = async (page: Page, definitionName: string, filename: string, csv: string): Promise<string> => {
  const { body } = await uploadFile(page, definitionName, { name: filename, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  expect(body.success).toBe(true);
  return body.upload.Id;
};

const uploadStatus = (page: Page, uploadId: string) =>
  expect.poll(async () => (await api(page, 'GET', `/uploads/${uploadId}`)).upload.Status, { timeout: 30_000 });

test('admins create one table per sheet from a multi-sheet XLSX example, with a suggested rule', async ({ page }) => {
  const name = `E2E Example ${Date.now()}`;
  const uploads: string[] = [];
  let definitionId = '';

  await login(page, ADMIN);
  try {
    await page.goto('/admin/file-definitions');
    await page.getByRole('button', { name: 'Add Definition' }).click();
    const form = page.locator('form');
    const assistant = form.getByRole('region', { name: 'Start from an example file' });

    await assistant.getByLabel('Example file').setInputFiles(XLSX_EXAMPLE);

    // Each populated sheet becomes a table; the admin leaves out the ReadMe sheet.
    const sheetsToInclude = assistant.getByRole('group', { name: 'Sheets to include (one table each)' });
    await expect(sheetsToInclude.getByRole('checkbox')).toHaveCount(3);
    await expect(sheetsToInclude).toContainText('Orders — 5 columns, 4 rows');
    await expect(sheetsToInclude).toContainText('Refunds — 2 columns, 2 rows');
    await sheetsToInclude.getByRole('checkbox', { name: /ReadMe/ }).uncheck();

    const proposed = assistant.getByRole('table', { name: 'Proposed columns' });
    await expect(assistant.getByLabel('Preview sheet')).toHaveValue('0');
    await expect(proposed.locator('tbody tr')).toHaveCount(5);
    await expect(proposed.getByRole('row', { name: /OrderId/ })).toContainText('integer');
    await expect(proposed.getByRole('row', { name: /Amount/ })).toContainText('decimal');
    await expect(proposed.getByRole('row', { name: /OrderDate/ })).toContainText('datetime');
    await expect(proposed.getByRole('row', { name: /Comment/ })).toContainText('No');

    // Numeric columns get a rounded-out range suggestion; identifiers such as OrderId do not.
    const suggestions = assistant.getByRole('group', { name: /Suggested rules for sheet "Orders"/ });
    await expect(suggestions.getByRole('checkbox')).toHaveCount(2);
    await expect(suggestions.getByRole('checkbox', { name: /Range Check Amount: 0\.\.20/ })).toBeVisible();
    await expect(suggestions.getByRole('checkbox', { name: /OrderId/ })).toHaveCount(0);
    await suggestions.getByRole('button', { name: 'Select all suggested rules' }).click();
    await expect(suggestions.getByRole('checkbox', { checked: true })).toHaveCount(2);
    await suggestions.getByRole('button', { name: 'Clear' }).click();
    await expect(suggestions.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await assistant.getByRole('checkbox', { name: /Status: Closed, Open/ }).check();

    await assistant.getByLabel('Preview sheet').selectOption({ label: 'Refunds — 2 columns, 2 rows' });
    await expect(proposed.locator('tbody tr')).toHaveCount(2);

    await assistant.getByRole('button', { name: 'Use 2 sheet tables' }).click();
    await expect(assistant).toContainText('Sheet tables from orders-example.xlsx (2 sheets) were applied');

    // The proposal lands in the editor for review: one section per sheet, with the rule scoped to Orders.
    await expect(form.getByRole('radio', { name: /One table per workbook sheet/ })).toBeChecked();
    await expect(form.getByLabel('Sheet name *')).toHaveCount(2);
    await expect(form.getByLabel('Sheet name *').first()).toHaveValue('Orders');
    await expect(form.getByLabel('Sheet name *').nth(1)).toHaveValue('Refunds');
    await expect(form.getByPlaceholder('Column name')).toHaveCount(7);
    await expect(form.locator('input[type="text"]').first()).toHaveValue('orders example');
    await form.locator('input[type="text"]').first().fill(name);
    await expect(form.getByText('Rules published with version 1')).toBeVisible();
    await expect(form.getByRole('listitem').filter({ hasText: 'Status allowed values' })).toContainText('Orders ›');

    definitionId = await createFromModal(page);
    await expect(page.getByRole('status')).toContainText(`"${name}" was created and published as version 1. It includes 1 rule.`);
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('2 sheets, 7 columns');

    const history = await api(page, 'GET', `/admin/file-definitions/${definitionId}/versions`);
    expect(history.hasUnpublishedChanges).toBe(false);
    expect(history.versions[0].columns).toEqual([]);
    expect(history.versions[0].tables).toEqual([
      {
        sheet: 'Orders',
        columns: [
          { name: 'OrderId', type: 'integer', required: true },
          { name: 'Amount', type: 'decimal', required: true },
          { name: 'OrderDate', type: 'datetime', required: true },
          { name: 'Status', type: 'string', required: true },
          { name: 'Comment', type: 'string', required: false },
        ],
      },
      { sheet: 'Refunds', columns: [{ name: 'OrderId', type: 'integer', required: true }, { name: 'Reason', type: 'string', required: true }] },
    ]);
    expect(history.versions[0].rules).toEqual([expect.objectContaining({ ruleType: 'Enum Check', expression: 'Status: Closed, Open', table: 'Orders' })]);

    // Uploads are validated sheet by sheet: sheet names match ignoring case and extra sheets are ignored.
    const valid = await uploadFile(page, name, path.join(FIXTURES, 'orders-upload-valid.xlsx'));
    uploads.push(valid.body.upload.Id);
    await uploadStatus(page, uploads[0]).toBe('VALIDATED');

    const missing = await uploadFile(page, name, path.join(FIXTURES, 'orders-upload-missing-refunds.xlsx'));
    uploads.push(missing.body.upload.Id);
    await uploadStatus(page, uploads[1]).toBe('VALIDATION_FAILED');
    await page.goto(`/admin/history/${uploads[1]}`);
    await expect(page.getByText('Sheet "Refunds" columns')).toBeVisible();

    // CSV files have no sheets, so they are rejected before upload.
    const csv = await uploadFile(page, name, { name: 'orders.csv', mimeType: 'text/csv', buffer: Buffer.from('OrderId\n1\n') });
    expect(csv.status).toBe(400);
    await expect(page.getByText('This definition expects an Excel workbook (.xlsx or .xls) with the sheets "Orders", "Refunds"')).toBeVisible();
  } finally {
    for (const id of uploads) await api(page, 'DELETE', `/uploads/${id}`);
    if (definitionId) await api(page, 'DELETE', `/admin/file-definitions/${definitionId}`);
  }
});

test('admins can keep one table for every sheet from a single-sheet workbook', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/admin/file-definitions');
  await page.getByRole('button', { name: 'Add Definition' }).click();
  const form = page.locator('form');
  const assistant = form.getByRole('region', { name: 'Start from an example file' });

  await assistant.getByLabel('Example file').setInputFiles(path.join(FIXTURES, 'orders-upload-missing-refunds.xlsx'));

  await expect(assistant.getByRole('group', { name: /Sheets to include/ })).toHaveCount(0);
  await expect(assistant.getByLabel('Sheet', { exact: true })).toHaveValue('0');
  await expect(assistant).toContainText('These columns will apply to every sheet of an uploaded workbook');
  await assistant.getByRole('button', { name: 'Use these columns' }).click();

  await expect(form.getByRole('radio', { name: /^One table/ }).first()).toBeChecked();
  await expect(form.getByPlaceholder('Column name')).toHaveCount(5);
  await expect(form.getByLabel('Sheet name *')).toHaveCount(0);
});

test('admins create a definition from a CSV example, which has no sheets', async ({ page }) => {
  const name = `E2E CSV Example ${Date.now()}`;
  let definitionId = '';

  await login(page, ADMIN);
  try {
    await page.goto('/admin/file-definitions');
    await page.getByRole('button', { name: 'Add Definition' }).click();
    const form = page.locator('form');
    await form.locator('input[type="text"]').first().fill(name);
    const assistant = form.getByRole('region', { name: 'Start from an example file' });

    await assistant.getByLabel('Example file').setInputFiles({
      name: 'customers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('CustomerId,Email,Active\n1,a@x.com,true\n2,b@x.com,false\n'),
    });

    await expect(assistant).toContainText('CSV files have no sheets');
    await expect(assistant.getByLabel('Sheet')).toHaveCount(0);
    await expect(assistant.getByRole('table', { name: 'Proposed columns' }).locator('tbody tr')).toHaveCount(3);
    await assistant.getByRole('button', { name: 'Use these columns' }).click();

    // The name the admin typed is kept, and the editor shows what the example contained.
    await expect(form.locator('input[type="text"]').first()).toHaveValue(name);
    await expect(form.getByText('Example: 2/2 rows filled · e.g. a@x.com, b@x.com')).toBeVisible();
    await expect(form.locator('select').nth(3)).toHaveValue('boolean');

    definitionId = await createFromModal(page);
    const history = await api(page, 'GET', `/admin/file-definitions/${definitionId}/versions`);
    expect(history.versions[0].columns).toEqual([
      { name: 'CustomerId', type: 'integer', required: true },
      { name: 'Email', type: 'string', required: true },
      { name: 'Active', type: 'boolean', required: true },
    ]);
    expect(history.versions[0].rules).toEqual([]);
  } finally {
    if (definitionId) await api(page, 'DELETE', `/admin/file-definitions/${definitionId}`);
  }
});

test('unsupported example files are rejected without changing the form', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/admin/file-definitions');
  await page.getByRole('button', { name: 'Add Definition' }).click();
  const form = page.locator('form');
  const assistant = form.getByRole('region', { name: 'Start from an example file' });

  await assistant.getByLabel('Example file').setInputFiles({
    name: 'fake.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('Id\n1\n'),
  });

  await expect(assistant.getByRole('alert')).toHaveText('The example file is not a valid XLSX workbook');
  await expect(form.getByPlaceholder('Column name')).toHaveValue('Column1');
});
