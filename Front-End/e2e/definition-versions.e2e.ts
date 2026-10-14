import { expect, test, type Page } from '@playwright/test';

// Drives definition versioning end to end: draft edits do not affect uploads until a new version is
// published, and every upload records the version it was validated against.

const API_URL = process.env.E2E_API_URL || 'http://localhost:3000/api/v1';
const PASSWORD = 'password123';
const ADMIN = 'admin@company.com';
const USER = 'user@company.com';
const USER_ID = '1C5E6A9B-BF1F-40E8-99DA-7893A8960CBA';

const login = async (page: Page, email: string) => {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in with Email' }).click();
  await expect(page).not.toHaveURL(/\/login/);
};

const api = async (page: Page, method: string, path: string, body?: unknown) => {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await page.request.fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
};

const uploadCsv = async (page: Page, definitionName: string, filename: string, csv: string): Promise<string> => {
  await page.goto('/admin/upload');
  await page.locator('select').first().selectOption({ label: definitionName });
  await page.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/uploads') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Upload and validate' }).click(),
  ]);
  const body = await response.json();
  expect(body.success).toBe(true);
  return body.upload.Id;
};

const expectUploadResult = async (page: Page, uploadId: string, status: string, version: string) => {
  await expect.poll(async () => (await api(page, 'GET', `/uploads/${uploadId}`)).upload.Status, { timeout: 30_000 }).toBe(status);
  await page.goto(`/admin/history/${uploadId}`);
  const versionItem = page.locator('div', { has: page.getByText('Definition Version', { exact: true }) }).last();
  await expect(versionItem).toContainText(version);
};

test('clean-slate wizard infers layout from the number of tables', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/admin/file-definitions');
  await page.getByRole('button', { name: 'New definition' }).click();
  const form = page.locator('form');
  await form.getByLabel('Name *').fill(`E2E clean wizard ${Date.now()}`);
  await form.getByRole('button', { name: /Start from a clean slate/ }).click();
  await expect(page.getByRole('button', { name: 'Back to file definitions' })).toHaveCount(0);
  await expect(form.getByRole('list', { name: 'Definition setup steps' }).getByRole('listitem')).toHaveCount(3);
  await form.getByRole('button', { name: 'Next' }).click();

  const firstTable = form.getByRole('region', { name: 'Table 1' });
  await expect(firstTable).toBeVisible();
  const columnsTable = firstTable.getByRole('table', { name: 'Columns for Table 1' });
  await expect(columnsTable.getByRole('columnheader', { name: 'Column' })).toBeVisible();
  await expect(columnsTable.getByRole('columnheader', { name: 'Type' })).toBeVisible();
  await expect(columnsTable.getByRole('columnheader', { name: 'Required' })).toBeVisible();
  await form.getByRole('button', { name: 'Add table' }).click();
  await expect(form.getByRole('region', { name: /Table \d/ })).toHaveCount(2);
  await form.getByLabel('Table name *').first().fill('Orders');
  await form.getByLabel('Table name *').nth(1).fill('Refunds');
  await form.getByRole('region', { name: 'Table 2' }).getByPlaceholder('Column name').fill('RefundId');
  await form.getByRole('region', { name: 'Table 2' }).getByLabel('Data type for RefundId').selectOption('integer');
  await form.getByRole('button', { name: 'Next' }).click();

  await expect(form.getByRole('heading', { name: 'Review and publish' })).toBeVisible();
  await expect(form.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(form.getByRole('heading', { name: 'Refunds' })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Back' })).toHaveCount(0);
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/admin\/file-definitions$/);
  await expect(page.getByRole('row', { name: /E2E clean wizard/ })).toHaveCount(0);
});

test('admins publish definition versions and uploads keep the version they arrived with', async ({ page }) => {
  test.setTimeout(300_000);
  const name = `E2E Versioning ${Date.now()}`;
  const uploads: string[] = [];
  let definitionId = '';
  let ruleId = '';

  await login(page, ADMIN);

  try {
    // Create: the definition is published as v1 immediately.
    await page.goto('/admin/file-definitions');
    await page.getByRole('button', { name: 'New definition' }).click();
    const form = page.locator('form');
    await form.getByLabel('Name *').fill(name);
    await form.getByRole('button', { name: /Start from a clean slate/ }).click();
    await form.getByRole('button', { name: 'Next' }).click();
    await form.getByPlaceholder('Column name').fill('Amount');
    await form.getByLabel('Data type for Amount').selectOption('decimal');
    await expect(form.getByLabel(/^Header row for/)).not.toBeVisible();
    await form.getByText('Table settings', { exact: true }).click();
    await expect(form.getByLabel(/^Header row for/)).toBeVisible();
    await form.getByRole('button', { name: 'Next' }).click();
    await expect(form.getByRole('heading', { name: 'Review and publish' })).toBeVisible();
    const [created] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/admin/file-definitions') && r.request().method() === 'POST'),
      form.getByRole('button', { name: 'Publish version 1' }).click(),
    ]);
    definitionId = (await created.json()).definition.id;
    await expect(page.getByRole('status')).toContainText(`"${name}" was created and published as version 1.`);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toContainText('v1');
    await expect(row).not.toContainText('Unpublished');

    // A decimal amount is valid under v1.
    uploads.push(await uploadCsv(page, name, 'amounts-v1.csv', 'Amount\n1.5\n'));
    await expectUploadResult(page, uploads[0], 'VALIDATED', 'v1');

    // Metadata-only edits use the same three-step workflow and create v2.
    await page.goto('/admin/file-definitions');
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/file-definitions/${definitionId}/edit$`));
    await expect(page.getByText(/Uploads keep using v1 until the new version is published/)).toBeVisible();
    await expect(form.getByRole('list', { name: 'Definition setup steps' }).getByRole('listitem')).toHaveCount(3);
    await expect(form.getByLabel('Data type for Amount')).toHaveCount(0);
    await expect(form.locator('input[type="file"]')).not.toBeVisible();
    await form.getByLabel('Description').fill('Metadata-only workflow update');
    await form.getByText('Delivery and reusable template', { exact: true }).click();
    await form.locator('input[type="file"]').setInputFiles({
      name: 'e2e-template.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Amount\n'),
    });
    await form.getByRole('button', { name: 'Next' }).click();
    await expect(form.locator('#definition-description')).toHaveCount(0);
    await expect(form.getByRole('table', { name: 'Columns for Table 1' })).toBeVisible();
    await expect(form.getByLabel('Data type for Amount')).toBeVisible();
    await expect(form.getByLabel(/^Header row for/)).not.toBeVisible();
    await form.getByText('Table settings', { exact: true }).click();
    await expect(form.getByLabel(/^Header row for/)).toBeVisible();
    await expect(form.getByLabel('Text encoding')).not.toBeVisible();
    await form.getByRole('button', { name: 'Next' }).click();
    await form.getByLabel('Change note (optional)').fill('Document metadata-only publishing');
    await form.getByRole('button', { name: 'Publish version 2' }).click();
    await expect(page.getByRole('status')).toContainText(`"${name}" was published as version 2.`);
    await expect(row).toContainText('v2');

    // A rule is a draft until the next editor publish.
    const rule = await api(page, 'POST', '/rules', {
      FileDefinitionId: definitionId,
      Config: {
        id: crypto.randomUUID(),
        name: 'Amount range',
        description: '',
        severity: 'Error',
        executionOrder: 1,
        enabled: true,
        table: null,
        type: 'range',
        params: { column: 'Amount', min: 0, max: 10, minInclusive: true, maxInclusive: true },
      },
    });
    ruleId = rule.rule.id;

    // Rule draft changes do not apply to new uploads yet.
    uploads.push(await uploadCsv(page, name, 'amounts-draft.csv', 'Amount\n1.5\n'));
    await expectUploadResult(page, uploads[1], 'VALIDATED', 'v2');

    // Contract edits publish with the existing rule as v3.
    await page.goto('/admin/file-definitions');
    await row.getByRole('button', { name: 'Edit' }).click();
    await form.getByText('Delivery and reusable template', { exact: true }).click();
    await form.getByRole('button', { name: 'Remove' }).click();
    await form.getByRole('button', { name: 'Next' }).click();
    await form.getByLabel('Data type for Amount').selectOption('integer');
    await form.getByRole('button', { name: 'Next' }).click();
    await form.getByLabel('Change note (optional)').fill('Whole-number amounts up to 10');
    await form.getByRole('button', { name: 'Publish version 3' }).click();
    await expect(page.getByRole('status')).toContainText(`"${name}" was published as version 3.`);

    await row.getByRole('button', { name: 'Versions' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/file-definitions/${definitionId}/versions$`));
    const versionsPanel = page.getByRole('region', { name: `Versions: ${name}` });
    await expect(versionsPanel).toContainText('No unpublished changes. New uploads are validated against v3.');
    await expect(versionsPanel.getByTestId('version-3')).toContainText('Active');
    await expect(versionsPanel.getByTestId('version-3')).toContainText('Whole-number amounts up to 10');
    await expect(versionsPanel.getByTestId('version-2')).toContainText('Document metadata-only publishing');
    await versionsPanel.getByTestId('version-2').getByRole('button').click();
    await expect(versionsPanel.getByTestId('version-2')).toContainText('e2e-template.csv');
    await versionsPanel.getByTestId('version-3').getByRole('button').click();
    await expect(versionsPanel.getByTestId('version-3')).toContainText('Reusable template');
    await expect(versionsPanel.getByTestId('version-3')).toContainText('None');
    await expect(versionsPanel.getByTestId('version-1')).toContainText('Superseded');
    await versionsPanel.getByTestId('version-1').getByRole('button').click();
    await expect(versionsPanel.getByTestId('version-1')).toContainText('decimal, required');
    await expect(versionsPanel.getByTestId('version-1')).toContainText('No rules');
    await versionsPanel.getByRole('button', { name: 'Back to definition' }).click();
    await page.getByRole('button', { name: 'Back to file definitions' }).click();
    await expect(page.getByRole('status')).toContainText(`"${name}" was published as version 3.`);
    await expect(row).toContainText('v3');
    await expect(row).not.toContainText('Unpublished');

    // The same file now fails, because it is validated against v3.
    uploads.push(await uploadCsv(page, name, 'amounts-v3.csv', 'Amount\n1.5\n'));
    await expectUploadResult(page, uploads[2], 'VALIDATION_FAILED', 'v3');
    await expect(page.getByText('Amount range')).toBeVisible();

    // Earlier uploads still report v1.
    await expectUploadResult(page, uploads[0], 'VALIDATED', 'v1');

    // Standard users see the published contract.
    await api(page, 'POST', `/admin/file-definitions/${definitionId}/users`, { userIds: [USER_ID] });
    await page.evaluate(() => localStorage.clear());
    await login(page, USER);
    await page.goto('/definitions');
    await page.getByRole('heading', { level: 3, name: new RegExp(name) }).click();
    await expect(page.getByText('Version v3, active since')).toBeVisible();
    await expect(page.getByText('integer', { exact: true })).toBeVisible();
    await page.goto('/rules');
    await page.locator('select').first().selectOption({ label: name });
    await expect(page.getByRole('note')).toContainText('published version v3');
    await expect(page.getByText('Amount range').first()).toBeVisible();
  } finally {
    await page.evaluate(() => localStorage.clear()).catch(() => undefined);
    await login(page, ADMIN);
    for (const id of uploads) await api(page, 'DELETE', `/uploads/${id}`);
    if (ruleId) await api(page, 'DELETE', `/rules/${ruleId}`);
    if (definitionId) await api(page, 'DELETE', `/admin/file-definitions/${definitionId}`);
  }
});
