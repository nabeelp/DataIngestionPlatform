import { defineConfig } from '@playwright/test';

// End-to-end UI tests. They drive the running app (start it with ..\start.ps1) using the local
// mock login, so VITE_DEV_BYPASS_AUTH and DEV_BYPASS_AUTH must be enabled for development.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    // Uses the installed Microsoft Edge; set E2E_BROWSER_CHANNEL=chromium to use Playwright's bundled browser.
    channel: process.env.E2E_BROWSER_CHANNEL || 'msedge',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: './test-results',
});
