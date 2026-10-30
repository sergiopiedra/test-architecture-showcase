import { defineConfig, devices } from '@playwright/test';

const ci = Boolean(process.env.CI);
const PORT = 3100;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: ci,
  // One retry in CI so a flake is reported (as "flaky") instead of blocking the build;
  // the nightly burn-in runs with zero retries to surface those flakes.
  retries: ci ? 1 : 0,
  workers: ci ? 2 : undefined,
  reporter: ci
    ? [
        ['list'],
        ['github'],
        ['html', { open: 'never' }],
        ['junit', { outputFile: 'reports/junit/e2e.xml' }],
      ]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testMatch: /.*\.api\.spec\.ts/ },
    { name: 'chromium', testMatch: /.*\.ui\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx tsx scripts/start-stack.ts',
    url: `http://127.0.0.1:${PORT}/health`,
    env: { PORT: String(PORT), PAYMENTS_PORT: '4110' },
    timeout: 120_000,
    reuseExistingServer: !ci,
    stdout: 'pipe',
  },
});
