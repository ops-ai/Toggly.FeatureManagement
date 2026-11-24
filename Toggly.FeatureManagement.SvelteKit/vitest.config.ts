import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: false, compilerOptions: { compatibility: { componentApi: 4 } } })],
  resolve: {
    conditions: ['browser'],
  },
  test: {
    environment: 'node',
    exclude: ['tests/host/**', 'tests/host-kit3/**', 'tests/host-browser/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 91, functions: 91, branches: 91, statements: 91 },
    },
  },
});
