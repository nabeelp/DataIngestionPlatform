import path from 'path';
import { fileURLToPath } from 'url';
import { expect, test, type Page } from '@playwright/test';

// Drives example-assisted definition creation: an admin proposes columns from an XLSX (choosing a sheet)
// or CSV example, reviews them, accepts a suggested rule, and uploads are then validated against them.

const API_URL = process.env.E2E_API_URL || 'http://localhost:3000/api/v1';
const PASSWORD = 'password123';
const ADMIN = 'admin@company.com';
const XLSX_EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'orders-example.xlsx');

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

const uploadCsv = async (page: Page, definitionName: string, filename: string, csv: string): Promise<string> => {
  await page.goto('/admin/upload');
  await page.locator('select').first().selectOption({ label: definitionName });
  await page.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/uploads') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Verify and Upload File' }).click(),
  ]);
  const body = await response.json();
  expect(body.success).toBe(true);
  return body.upload.Id;
};

const uploadStatus = (page: Page, uploadId: string) =>
  expect.poll(async () => (await api(page, 'GET', `/uploads/${uploadId}`)).upload.Status, { timeout: 30_000 });

test('admins create a definition from an XLSX example sheet with a suggested rule', async ({ page }) => {
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

    // Workbooks offer a sheet choice; the populated Orders sheet is selected by default.
    const sheet = assistant.getByLabel('Sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('option')).toHaveText(['Orders — 5 columns, 4 rows', 'ReadMe — 1 column, 1 row']);
    await expect(assistant).toContainText('Sheets have different columns');
    const proposed = assistant.getByRole('table', { name: 'Proposed columns' });
    await expect(proposed.locator('tbody tr')).toHaveCount(5);
    await expect(proposed.getByRole('row', { name: /OrderId/ })).toContainText('integer');
    await expect(proposed.getByRole('row', { name: /Amount/ })).toContainText('decimal');
    await expect(proposed.getByRole('row', { name: /OrderDate/ })).toContainText('datetime');
    await expect(proposed.getByRole('row', { name: /Comment/ })).toContainText('No');

    await assistant.getByRole('checkbox', { name: /Status: Closed, Open/ }).check();
    await assistant.getByRole('button', { name: 'Use these columns' }).click();
    await expect(assistant).toContainText('Columns from orders-example.xlsx › Orders were applied');

    // The proposal lands in the normal editor for review; the admin names the definition and tightens a column.
    await expect(form.getByPlaceholder('Column name')).toHaveCount(5);
    await expect(form.locator('input[type="text"]').first()).toHaveValue('orders example');
    await form.locator('input[type="text"]').first().fill(name);
    await expect(form.getByText('Rules published with version 1')).toBeVisible();

    definitionId = await createFromModal(page);
    await expect(page.getByRole('status')).toContainText(`"${name}" was created and published as version 1. It includes 1 rule.`);

    const history = await api(page, 'GET', `/admin/file-definitions/${definitionId}/versions`);
    expect(history.hasUnpublishedChanges).toBe(false);
    expect(history.versions[0].columns).toEqual([
      { name: 'OrderId', type: 'integer', required: true },
      { name: 'Amount', type: 'decimal', required: true },
      { name: 'OrderDate', type: 'datetime', required: true },
      { name: 'Status', type: 'string', required: true },
      { name: 'Comment', type: 'string', required: false },
    ]);
    expect(history.versions[0].rules).toEqual([expect.objectContaining({ ruleType: 'Enum Check', expression: 'Status: Closed, Open' })]);

    // Uploads are validated against the proposed contract, including the accepted rule.
    const header = 'OrderId,Amount,OrderDate,Status,Comment\n';
    uploads.push(await uploadCsv(page, name, 'good.csv', `${header}2001,3.5,2024-03-01,Open,\n`));
    await uploadStatus(page, uploads[0]).toBe('VALIDATED');
    uploads.push(await uploadCsv(page, name, 'bad-status.csv', `${header}2002,4,2024-03-02,Pending,\n`));
    await uploadStatus(page, uploads[1]).toBe('VALIDATION_FAILED');
  } finally {
    for (const id of uploads) await api(page, 'DELETE', `/uploads/${id}`);
    if (definitionId) await api(page, 'DELETE', `/admin/file-definitions/${definitionId}`);
  }
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
