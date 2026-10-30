import { defineConfig } from 'vitest/config';

const ci = Boolean(process.env.CI);

export default defineConfig({
  test: {
    reporters: ci ? ['default', 'junit', 'github-actions'] : ['default'],
    outputFile: { junit: 'reports/junit/vitest.xml' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: 'reports/coverage',
      // A ratchet set just under the current numbers: coverage may not silently drop.
      thresholds: {
        lines: 97,
        branches: 92,
        functions: 95,
        statements: 95,
        // Pure business rules: every line and branch is reachable from a unit test.
        'src/domain/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/support/postgres-global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'contract-consumer',
          include: ['tests/contract/**/*.consumer.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'contract-provider',
          include: ['tests/contract/**/*.provider.test.ts'],
          testTimeout: 60_000,
        },
      },
    ],
  },
});
