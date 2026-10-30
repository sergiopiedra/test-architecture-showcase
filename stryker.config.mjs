// @ts-check
/**
 * Mutation testing answers "would our tests notice if this code were wrong?".
 * Stryker makes small changes (mutants) to the domain code, e.g. `>=` -> `>`,
 * and runs the unit tests against each one. A mutant that no test kills is a
 * gap in the assertions, even when coverage says the line is "covered".
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.ts' },
  mutate: ['src/domain/**/*.ts'],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  // The build fails below `break`.
  thresholds: { high: 95, low: 90, break: 90 },
  tempDirName: '.stryker-tmp',
};
