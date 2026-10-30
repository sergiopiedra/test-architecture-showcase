import { defineConfig } from 'vitest/config';

/** Unit tests only: Stryker runs them once per mutant, so they must be fast and hermetic. */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
