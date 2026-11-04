import { defineConfig } from 'vitest/config';

/**
 * Node-environment suite: fetch-mocked flag/cache accounting and telemetry unit
 * tests. Keep these independent of workerd so they stay fast and deterministic.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/workerd/**', 'node_modules/**'],
  },
});
