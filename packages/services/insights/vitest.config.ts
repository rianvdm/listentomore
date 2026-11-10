// ABOUTME: Vitest config for the insights package - pure functions, so tests run in plain Node.
// ABOUTME: Globals are on, so test files use it/expect without importing them.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.ts'],
  },
});
