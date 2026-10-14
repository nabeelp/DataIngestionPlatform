import { stat } from 'node:fs/promises';
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

const createFromWorkspace = async (page: Page): Promise<string> => {
  const [created] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/admin/file-definitions') && r.request().method() === 'POST'),
    page.locator('form').getByRole('button', { name: 'Publish version 1' }).click(),
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
    page.getByRole('button', { name: 'Upload and validate' }).click(),
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
    await page.getByRole('button', { name: 'New definition' }).click();
    await expect(page).toHaveURL(/\/admin\/file-definitions\/new$/);
    const form = page.locator('form');
    await form.getByLabel('Name *').fill(name);
    await form.getByRole('button', { name: /Start from an example file/ }).click();
    await expect(form.getByRole('list', { name: 'Definition setup steps' }).getByRole('listitem')).toHaveCount(4);
    await form.getByRole('button', { name: 'Next' }).click();
    const assistant = form.getByRole('region', { name: 'Start from an example file' });
    await expect(form.getByRole('button', { name: 'Next' })).toBeDisabled();
    await expect(assistant.getByRole('button', { name: /Discard|Use .*sheet tables|Use these columns/ })).toHaveCount(0);

    await assistant.getByLabel('Example file').setInputFiles(XLSX_EXAMPLE);

    // Every sheet is visible at once. Excluding a sheet collapses and greys it out; including it expands it again.
    const orders = assistant.getByRole('region', { name: 'Detected table Orders' });
    const refunds = assistant.getByRole('region', { name: 'Detected table Refunds' });
    const readMe = assistant.getByRole('region', { name: 'Detected table ReadMe' });
    await expect(orders).toBeVisible();
    await expect(refunds).toBeVisible();
    await expect(readMe).toBeVisible();
    await readMe.getByRole('checkbox', { name: 'Include sheet ReadMe' }).uncheck();
    await expect(readMe.getByRole('table')).toHaveCount(0);
    await expect(readMe).toHaveClass(/bg-gray-100/);
    await readMe.getByRole('checkbox', { name: 'Include sheet ReadMe' }).check();
    await expect(readMe.getByRole('table')).toBeVisible();
    await readMe.getByRole('checkbox', { name: 'Include sheet ReadMe' }).uncheck();

    const proposed = orders.getByRole('table', { name: 'Proposed columns for Orders' });
    await expect(proposed.locator('tbody tr')).toHaveCount(5);
    await expect(orders.getByLabel('Type for OrderId in Orders')).toHaveValue('integer');
    await expect(orders.getByLabel('Type for Amount in Orders')).toHaveValue('decimal');
    await expect(orders.getByLabel('Type for OrderDate in Orders')).toHaveValue('datetime');
    await expect(orders.getByLabel('Required for Comment in Orders')).not.toBeChecked();
    await orders.getByLabel('Type for Amount in Orders').selectOption('string');
    await orders.getByLabel('Required for Status in Orders').uncheck();

    // Numeric columns get a rounded-out range suggestion; identifiers such as OrderId do not.
    const suggestions = orders.getByRole('group', { name: /Suggested rules for Orders/ });
    await expect(suggestions.getByRole('checkbox')).toHaveCount(2);
    await expect(suggestions.getByRole('checkbox', { name: /Range Check Amount: 0\.\.20/ })).toBeVisible();
    await expect(suggestions.getByRole('checkbox', { name: /OrderId/ })).toHaveCount(0);
    await suggestions.getByRole('button', { name: 'Select all suggested rules' }).click();
    await expect(suggestions.getByRole('checkbox', { checked: true })).toHaveCount(2);
    await suggestions.getByRole('button', { name: 'Clear' }).click();
    await expect(suggestions.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await orders.getByRole('checkbox', { name: /Status: Closed, Open/ }).check();
    await expect(refunds.getByRole('table', { name: 'Proposed columns for Refunds' }).locator('tbody tr')).toHaveCount(2);

    await expect(form.getByRole('button', { name: 'Next' })).toBeEnabled();
    await form.getByRole('button', { name: 'Next' }).click();

    // Step 3 uses the same editable tables-and-columns layout as the clean-slate flow.
    await expect(form.getByRole('region', { name: 'Table 1' })).toBeVisible();
    await expect(form.getByRole('region', { name: 'Table 2' })).toBeVisible();
    await expect(form.getByLabel('Table name *').first()).toHaveValue('Orders');
    await expect(form.getByLabel('Table name *').nth(1)).toHaveValue('Refunds');
    await expect(form.getByPlaceholder('Column name')).toHaveCount(7);
    await expect(form.getByRole('button', { name: 'Back' })).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await form.getByRole('button', { name: 'Next' }).click();
    await expect(form.getByRole('heading', { name: 'Review and publish' })).toBeVisible();
    await expect(form.getByText('Status allowed values')).toBeVisible();

    definitionId = await createFromWorkspace(page);
    await expect(page.getByRole('status')).toContainText(`"${name}" was created and published as version 1. It includes 1 rule.`);
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('2 sheets, 7 columns');

    const history = await api(page, 'GET', `/admin/file-definitions/${definitionId}/versions`);
    const definitions = await api(page, 'GET', '/admin/file-definitions');
    const savedDefinition = definitions.definitions.find((definition: { id: string }) => definition.id === definitionId);
    expect(savedDefinition.contract).toMatchObject({
      layout: 'sheets',
      encoding: 'auto',
      ignoredSheets: [],
      tables: [
        { sheet: 'Orders' },
        { sheet: 'Refunds' },
      ],
      rules: [],
    });
    expect(history.hasUnpublishedChanges).toBe(false);
    expect(history.versions[0].columns).toEqual([]);
    expect(history.versions[0].tables).toEqual([
      {
        sheet: 'Orders',
        columns: [
          { name: 'OrderId', type: 'integer', required: true },
          { name: 'Amount', type: 'string', required: true },
          { name: 'OrderDate', type: 'datetime', required: true },
          { name: 'Status', type: 'string', required: false },
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
    const [reportDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download full issues report' }).click(),
    ]);
    const reportPath = await reportDownload.path();
    expect(reportPath).toBeTruthy();
    if (!reportPath) throw new Error('The issues report download did not produce a local file.');
    expect((await stat(reportPath)).size).toBeGreaterThan(0);

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
  await page.getByRole('button', { name: 'New definition' }).click();
  const form = page.locator('form');
  await form.getByLabel('Name *').fill(`E2E single example ${Date.now()}`);
  await form.getByRole('button', { name: /Start from an example file/ }).click();
  await form.getByRole('button', { name: 'Next' }).click();
  const assistant = form.getByRole('region', { name: 'Start from an example file' });

  await assistant.getByLabel('Example file').setInputFiles(path.join(FIXTURES, 'orders-upload-missing-refunds.xlsx'));

  const detected = assistant.getByRole('region', { name: /Detected table/ });
  await expect(detected).toHaveCount(1);
  await expect(detected.getByRole('table')).toBeVisible();
  await form.getByRole('button', { name: 'Next' }).click();
  await expect(form.getByPlaceholder('Column name')).toHaveCount(5);
  await expect(form.getByRole('heading', { name: 'Orders' })).toHaveCount(0);
});

test('admins create a definition from a CSV example, which has no sheets', async ({ page }) => {
  const name = `E2E CSV Example ${Date.now()}`;
  let definitionId = '';

  await login(page, ADMIN);
  try {
    await page.goto('/admin/file-definitions');
    await page.getByRole('button', { name: 'New definition' }).click();
    const form = page.locator('form');
    await form.getByLabel('Name *').fill(name);
    await form.getByRole('button', { name: /Start from an example file/ }).click();
    await form.getByRole('button', { name: 'Next' }).click();
    const assistant = form.getByRole('region', { name: 'Start from an example file' });

    await assistant.getByLabel('Example file').setInputFiles({
      name: 'customers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('CustomerId,Email,Active\n1,a@x.com,true\n2,b@x.com,false\n'),
    });

    await expect(assistant).toContainText('CSV files have no sheets');
    await expect(assistant.getByLabel('Sheet')).toHaveCount(0);
    await expect(assistant.getByRole('table', { name: 'Proposed columns for CSV table' }).locator('tbody tr')).toHaveCount(3);
    await form.getByRole('button', { name: 'Next' }).click();

    // The name the admin typed is kept, and the shared editor contains the inferred columns.
    await expect(form.getByRole('table', { name: 'Columns for Table 1' }).getByPlaceholder('Column name')).toHaveCount(3);
    await form.getByRole('button', { name: 'Next' }).click();
    await expect(form.getByRole('region', { name: 'Review table Single table' })).toContainText('boolean');

    definitionId = await createFromWorkspace(page);
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
  await page.getByRole('button', { name: 'New definition' }).click();
  const form = page.locator('form');
  await form.getByLabel('Name *').fill(`E2E unsupported ${Date.now()}`);
  await form.getByRole('button', { name: /Start from an example file/ }).click();
  await form.getByRole('button', { name: 'Next' }).click();
  const assistant = form.getByRole('region', { name: 'Start from an example file' });

  await assistant.getByLabel('Example file').setInputFiles({
    name: 'fake.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('Id\n1\n'),
  });

  await expect(assistant.getByRole('alert')).toHaveText('The example file could not be analyzed.');
  await expect(form.getByPlaceholder('Column name')).toHaveCount(0);
});
