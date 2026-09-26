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
    page.getByRole('button', { name: 'Verify and Upload File' }).click(),
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

test('admins publish definition versions and uploads keep the version they arrived with', async ({ page }) => {
  const name = `E2E Versioning ${Date.now()}`;
  const uploads: string[] = [];
  let definitionId = '';
  let ruleId = '';

  await login(page, ADMIN);

  try {
    // Create: the definition is published as v1 immediately.
    await page.goto('/admin/file-definitions');
    await page.getByRole('button', { name: 'Add Definition' }).click();
    const form = page.locator('form');
    await form.locator('input[type="text"]').first().fill(name);
    await form.getByPlaceholder('Column name').fill('Amount');
    await form.locator('select').nth(1).selectOption('decimal');
    const [created] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/admin/file-definitions') && r.request().method() === 'POST'),
      form.getByRole('button', { name: 'Create' }).click(),
    ]);
    definitionId = (await created.json()).definition.id;
    await expect(page.getByRole('status')).toContainText(`"${name}" was created and published as version 1.`);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toContainText('v1');
    await expect(row).not.toContainText('Unpublished');

    // A decimal amount is valid under v1.
    uploads.push(await uploadCsv(page, name, 'amounts-v1.csv', 'Amount\n1.5\n'));
    await expectUploadResult(page, uploads[0], 'VALIDATED', 'v1');

    // Draft edits: make Amount an integer and add a range rule.
    await page.goto('/admin/file-definitions');
    await row.getByTitle('Edit').click();
    await expect(page.getByText('Uploads keep using v1 until you publish a new version')).toBeVisible();
    await form.locator('select').nth(1).selectOption('integer');
    await form.getByRole('button', { name: 'Update' }).click();
    await expect(page.getByRole('status')).toContainText('has unpublished changes. Uploads keep using v1');
    await expect(row).toContainText('Unpublished');
    const rule = await api(page, 'POST', '/rules', {
      FileDefinitionId: definitionId, Name: 'Amount range', RuleType: 'Range Check', SqlQuery: 'Amount: 0..10',
    });
    ruleId = rule.rule.Id;

    // Draft changes do not apply to new uploads yet.
    uploads.push(await uploadCsv(page, name, 'amounts-draft.csv', 'Amount\n1.5\n'));
    await expectUploadResult(page, uploads[1], 'VALIDATED', 'v1');

    // Review and publish v2 from the Versions dialog.
    await page.goto('/admin/file-definitions');
    await page.getByRole('button', { name: `Versions for ${name}` }).click();
    const dialog = page.getByRole('dialog');
    const changes = dialog.getByRole('region', { name: 'Unpublished changes' });
    await expect(changes).toContainText('Uploads are still validated against v1');
    await expect(changes).toContainText('Changed: Amount');
    await expect(changes).toContainText('Added: Amount range');
    await dialog.getByLabel('Change note (optional)').fill('Whole-number amounts up to 10');
    await dialog.getByRole('button', { name: 'Publish version 2' }).click();
    await expect(dialog).toContainText('No unpublished changes. New uploads are validated against v2.');
    await expect(dialog.getByTestId('version-2')).toContainText('Active');
    await expect(dialog.getByTestId('version-2')).toContainText('Whole-number amounts up to 10');
    await expect(dialog.getByTestId('version-1')).toContainText('Superseded');
    await dialog.getByTestId('version-1').getByRole('button').click();
    await expect(dialog.getByTestId('version-1')).toContainText('decimal, required');
    await expect(dialog.getByTestId('version-1')).toContainText('No rules');
    await dialog.getByRole('button', { name: 'Close versions' }).click();
    await expect(page.getByRole('status')).toContainText('version 2 is now active');
    await expect(row).toContainText('v2');
    await expect(row).not.toContainText('Unpublished');

    // The same file now fails, because it is validated against v2.
    uploads.push(await uploadCsv(page, name, 'amounts-v2.csv', 'Amount\n1.5\n'));
    await expectUploadResult(page, uploads[2], 'VALIDATION_FAILED', 'v2');
    await expect(page.getByText('Amount range')).toBeVisible();

    // Earlier uploads still report v1.
    await expectUploadResult(page, uploads[0], 'VALIDATED', 'v1');

    // Standard users see the published contract.
    await api(page, 'POST', `/admin/file-definitions/${definitionId}/users`, { userIds: [USER_ID] });
    await page.evaluate(() => localStorage.clear());
    await login(page, USER);
    await page.goto('/definitions');
    await page.getByRole('heading', { level: 3, name: new RegExp(name) }).click();
    await expect(page.getByText('Version v2, active since')).toBeVisible();
    await expect(page.getByText('integer', { exact: true })).toBeVisible();
    await page.goto('/rules');
    await page.locator('select').first().selectOption({ label: name });
    await expect(page.getByRole('note')).toContainText('Showing the rules of published version v2');
    await expect(page.getByText('Amount range').first()).toBeVisible();
  } finally {
    await page.evaluate(() => localStorage.clear()).catch(() => undefined);
    await login(page, ADMIN);
    for (const id of uploads) await api(page, 'DELETE', `/uploads/${id}`);
    if (ruleId) await api(page, 'DELETE', `/rules/${ruleId}`);
    if (definitionId) await api(page, 'DELETE', `/admin/file-definitions/${definitionId}`);
  }
});
