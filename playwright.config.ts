import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'reports/browser-tests.json' }]],
  use: { baseURL: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: process.env.TEST_BASE_URL ? undefined : {
    command: 'node scripts/run.mjs dev', url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI, timeout: 30_000,
    gracefulShutdown: { signal: 'SIGINT', timeout: 5000 },
  },
});
