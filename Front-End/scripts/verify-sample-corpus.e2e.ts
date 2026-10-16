import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type APIResponse } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLES = path.join(ROOT, 'samples');
const API_URL = process.env.E2E_API_URL || 'http://localhost:3000/api/v1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@company.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'password123';
const manifest = JSON.parse(fs.readFileSync(path.join(SAMPLES, 'manifest.json'), 'utf8')) as {
  files: {
    file: string;
    kind: 'upload' | 'example';
    definition?: string;
    expected: Record<string, any>;
  }[];
};
const definitions = JSON.parse(fs.readFileSync(path.join(SAMPLES, 'definitions', 'sample_definitions.json'), 'utf8')) as
  Record<string, { name: string; tables: unknown[] }>;
// Engine truth per sample (status, failing/warning checks, rows), reviewed in Validation-Service/tests/golden.
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'Validation-Service', 'tests', 'golden', 'expected_outcomes.json'), 'utf8')) as
  Record<string, { status: string; failedChecks?: string[]; warningChecks?: string[]; rows?: number }>;
const TERMINAL_UPLOAD_STATUSES = new Set(['VALIDATED', 'VALIDATION_FAILED', 'DELIVERED', 'DELIVERY_FAILED']);
const SUPPORTED_UPLOAD_EXTENSIONS = new Set(['.csv', '.tsv', '.txt', '.xlsx', '.xls']);
const UNSUPPORTED_UPLOAD_MESSAGE = 'Please select a CSV, TSV, TXT, or Excel file (.xlsx, .xls)';

const readJson = async (response: APIResponse) => {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Error(`Expected JSON from the API, received HTTP ${response.status()}.`);
  }
};

const api = async (page: Page, token: string, method: string, route: string, body?: unknown) => {
  const response = await page.request.fetch(`${API_URL}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    data: body === undefined ? undefined : JSON.stringify(body),
    timeout: 5 * 60 * 1000,
  });
  return { response, body: await readJson(response) };
};

const normalizeRuleName = (name: string) => name.replace(/\s+\([^()]*\)$/, '');

const normalizeCheckName = (name: string, singleLayout: boolean) => {
  const normalized = normalizeRuleName(name);
  return singleLayout && /^Sheet ".*" columns$/.test(normalized) ? 'File definition columns' : normalized;
};

const expectRowCount = (value: unknown, expected: number, file: string) => {
  const actual = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  expect(Number.isSafeInteger(actual), `${file}: row count is not an integer`).toBe(true);
  expect(actual, file).toBe(expected);
};

const uploadViaUi = async (page: Page, definitionName: string, filePath: string) => {
  await page.goto('/admin/upload');
  await page.locator('select').first().selectOption({ label: definitionName });
  await page.locator('input[type="file"]').setInputFiles(filePath);
  const [response] = await Promise.all([
    page.waitForResponse(candidate =>
      new URL(candidate.url()).pathname.endsWith('/uploads') && candidate.request().method() === 'POST',
      { timeout: 5 * 60 * 1000 },
    ),
    page.getByRole('button', { name: 'Verify and Upload File' }).click(),
  ]);
  return { response, body: await readJson(response) };
};

const waitForUpload = async (page: Page, token: string, uploadId: string) => {
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const { response, body } = await api(page, token, 'GET', `/uploads/${uploadId}`);
    expect(response.status(), `Could not read upload ${uploadId}`).toBe(200);
    const status = body.upload?.Status;
    if (TERMINAL_UPLOAD_STATUSES.has(status)) return body;
    await page.waitForTimeout(2_000);
  }
  throw new Error(`Upload ${uploadId} did not reach a terminal status within 30 minutes.`);
};

const verifyExample = async (page: Page, token: string, entry: typeof manifest.files[number]) => {
  const filePath = path.join(SAMPLES, entry.file);
  if (!fs.existsSync(filePath)) throw new Error(`Required sample fixture is missing: ${entry.file}`);
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = extension === '.csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const response = await page.request.post(`${API_URL}/admin/file-definitions/analyze-example`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: path.basename(filePath), mimeType, buffer: fs.readFileSync(filePath) },
    },
    timeout: 5 * 60 * 1000,
  });
  const body = await readJson(response);
  if (entry.expected.result === 'REJECTED') {
    expect(response.status(), entry.file).toBeGreaterThanOrEqual(400);
    expect(response.status(), entry.file).toBeLessThan(500);
  } else {
    expect(response.status(), `${entry.file}: ${body.message || 'example analysis failed'}`).toBe(200);
    expect(body.success, entry.file).toBe(true);
    expect(Array.isArray(body.sheets), entry.file).toBe(true);
    if (entry.expected.layout) {
      const populated = body.sheets.filter((sheet: any) => sheet.columns?.length > 0);
      const layout = body.fileType === 'xlsx' && populated.length > 1 ? 'sheets' : 'single';
      expect(layout, entry.file).toBe(entry.expected.layout);
    }
  }
};

test('runs all upload and example samples through the local UI and APIs', async ({ page }) => {
  test.setTimeout(60 * 60 * 1000);

  await page.goto('/login');
  await page.locator('#email').fill(ADMIN_EMAIL);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in with Email' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const token = await page.evaluate(() => localStorage.getItem('token'));
  expect(token).toBeTruthy();

  const { response: definitionResponse, body: definitionBody } = await api(page, token!, 'GET', '/admin/file-definitions');
  expect(definitionResponse.status()).toBe(200);
  const byName = new Map<string, { id: string; name: string }>(
    definitionBody.definitions.map((definition: any) => [definition.name, definition]),
  );

  for (const [key, sampleDefinition] of Object.entries(definitions)) {
    const definition = byName.get(sampleDefinition.name);
    if (!definition) {
      throw new Error(`Missing sample definition "${sampleDefinition.name}". Run samples/definitions/sample_definitions.sql first.`);
    }
    const { body: versionState } = await api(page, token!, 'GET', `/admin/file-definitions/${definition.id}/versions`);
    if (versionState.activeVersionNumber === null || versionState.hasUnpublishedChanges) {
      const { response, body } = await api(page, token!, 'POST', `/admin/file-definitions/${definition.id}/versions`, {
        changeNote: 'Sample corpus end-to-end verification',
      });
      expect(response.status(), `${sampleDefinition.name}: ${body.message || 'publish failed'}`).toBe(201);
    }
    byName.set(sampleDefinition.name, definition);
    console.log(`READY ${key}: ${sampleDefinition.name}`);
  }

  let firstIssuesUpload: { id: string; ruleName: string } | null = null;
  let uploadsChecked = 0;
  let examplesChecked = 0;

  for (const entry of manifest.files) {
    const filePath = path.join(SAMPLES, entry.file);
    if (!fs.existsSync(filePath)) throw new Error(`Required sample fixture is missing: ${entry.file}`);

    if (entry.kind === 'example') {
      await verifyExample(page, token!, entry);
      examplesChecked++;
      console.log(`EXAMPLE ${entry.file}`);
      continue;
    }

    const definitionName = definitions[entry.definition!]?.name;
    if (!definitionName) throw new Error(`Unknown sample definition key "${entry.definition}".`);
    const extension = path.extname(filePath).toLowerCase();
    if (entry.expected.status === 'UPLOAD_REJECTED' && !SUPPORTED_UPLOAD_EXTENSIONS.has(extension)) {
      await page.goto('/admin/upload');
      await page.locator('select').first().selectOption({ label: definitionName });
      await page.locator('input[type="file"]').setInputFiles(filePath);
      await expect(page.getByText(UNSUPPORTED_UPLOAD_MESSAGE, { exact: true }), entry.file).toBeVisible();
      uploadsChecked++;
      console.log(`REJECTED ${entry.file}`);
      continue;
    }

    const { response, body } = await uploadViaUi(page, definitionName, filePath);
    if (entry.expected.status === 'UPLOAD_REJECTED') {
      expect(response.status(), `${entry.file}: ${body.message || 'upload was not rejected'}`).toBeGreaterThanOrEqual(400);
      expect(response.status(), entry.file).toBeLessThan(500);
      uploadsChecked++;
      console.log(`REJECTED ${entry.file}`);
      continue;
    }

    expect(response.status(), `${entry.file}: ${body.message || 'upload failed'}`).toBe(201);
    expect(body.success, entry.file).toBe(true);
    const uploadId = body.upload.Id as string;
    const result = await waitForUpload(page, token!, uploadId);
    const status = result.upload.Status as string;
    const relative = entry.file;
    // Where the engine intentionally differs from the manifest's product expectation (see the golden snapshot),
    // only the terminal status is verified end to end.
    const snap = snapshot[relative];
    const hasIntentionalDifference = !!snap && (
      snap.status !== entry.expected.status
      || JSON.stringify(snap.failedChecks ?? []) !== JSON.stringify(entry.expected.failedChecks ?? [])
      || (entry.expected.rows !== undefined && snap.rows !== undefined && snap.rows !== entry.expected.rows)
    );
    expect(TERMINAL_UPLOAD_STATUSES.has(status), `${entry.file}: ${status}`).toBe(true);

    if (!hasIntentionalDifference) {
      const expectedStatus = ['PASSED', 'WARNING'].includes(entry.expected.status)
        ? ['VALIDATED', 'DELIVERED']
        : ['VALIDATION_FAILED'];
      expect(expectedStatus, `${entry.file}: unexpected live status ${status}`).toContain(status);
      if (entry.expected.rows !== undefined) expectRowCount(result.upload.RowCountNo, entry.expected.rows, entry.file);
      const ruleDetails = result.ruleDetails ?? [];
      const singleLayout = definitions[entry.definition!].tables.length === 0;
      const actualFailed = ruleDetails.filter((rule: any) => rule.Status === 'FAILED')
        .map((rule: any) => normalizeCheckName(rule.RuleName, singleLayout)).sort();
      const actualWarnings = ruleDetails.filter((rule: any) => rule.Status === 'WARNING')
        .map((rule: any) => normalizeCheckName(rule.RuleName, singleLayout)).sort();
      expect(actualFailed, `${entry.file}: failed checks`).toEqual([...(entry.expected.failedChecks ?? [])].sort());
      expect(actualWarnings, `${entry.file}: warning checks`).toEqual([...(entry.expected.warningChecks ?? [])].sort());
      for (const [name, count] of Object.entries(entry.expected.errorCounts ?? {})) {
        const check = ruleDetails.find((rule: any) => normalizeCheckName(rule.RuleName, singleLayout) === name);
        expect(check?.IssueCount, `${entry.file}: ${name} issue count`).toBe(count);
      }
    }

    const ruleDetails = result.ruleDetails ?? [];
    const issueChecks = ruleDetails.filter((rule: any) => Number(rule.IssueCount) > 0);
    if (issueChecks.length > 0) {
      const report = await page.request.get(`${API_URL}/uploads/${uploadId}/report`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5 * 60 * 1000,
      });
      expect(report.status(), `${entry.file}: issues report unavailable`).toBe(200);
      expect(report.headers()['content-type']).toContain('text/csv');
      expect((await report.body()).length, `${entry.file}: empty issues report`).toBeGreaterThan(0);
      firstIssuesUpload ??= { id: uploadId, ruleName: normalizeRuleName(issueChecks[0].RuleName) };
    }

    const deliveryRecords = result.deliveryRecords ?? [];
    if (deliveryRecords.length > 0) {
      expect(deliveryRecords.every((record: any) => record.Status === 'DELIVERED'), `${entry.file}: delivery incomplete`).toBe(true);
    } else if (status === 'VALIDATED') {
      expect(status, `${entry.file}: no delivery target should finish as validated`).toBe('VALIDATED');
    }
    uploadsChecked++;
    console.log(`UPLOAD ${entry.file}: ${status}, rows=${result.upload.RowCountNo ?? 0}, checks=${ruleDetails.length}`);
  }

  expect(uploadsChecked).toBe(manifest.files.filter(entry => entry.kind === 'upload').length);
  expect(examplesChecked).toBe(manifest.files.filter(entry => entry.kind === 'example').length);
  expect(firstIssuesUpload, 'The corpus should contain an upload with reportable issues').not.toBeNull();
  await page.goto(`/admin/history/${firstIssuesUpload!.id}`);
  await expect(page.getByText(firstIssuesUpload!.ruleName, { exact: false })).toBeVisible();
  const reportLink = page.getByRole('link', { name: /Download full issues report/i });
  await expect(reportLink).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), reportLink.click()]);
  expect(download.suggestedFilename()).toMatch(/issues(?:_report)?\.csv$/i);
  const downloadedPath = await download.path();
  if (!downloadedPath) throw new Error('The issues report download did not produce a file.');
  expect(fs.statSync(downloadedPath).size).toBeGreaterThan(0);
  console.log(`Verified ${uploadsChecked} uploads and ${examplesChecked} example analyses.`);
});
