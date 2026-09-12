import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    exclude: ['tests/host/**', 'tests/host-browser/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 91, functions: 91, branches: 91, statements: 91 },
    },
  },
});
