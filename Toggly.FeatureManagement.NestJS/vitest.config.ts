import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    env: { TOGGLY_DISABLE_TELEMETRY: '1' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/types.ts'],
      thresholds: { lines: 91, statements: 91, functions: 91, branches: 91 },
    },
  },
});
