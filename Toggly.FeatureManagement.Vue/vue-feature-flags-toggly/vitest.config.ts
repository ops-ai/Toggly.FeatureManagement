import { createRequire } from 'node:module';
import { defineConfig, configDefaults } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// Vitest loads the package ESM build, which still uses require('crypto') on Node.
// Point tests at the published CJS entry (same npm package, not monorepo source).
const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@ops-ai/toggly-signed-defs': require.resolve('@ops-ai/toggly-signed-defs'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: [...configDefaults.exclude, 'node_modules', 'dist', 'example', '**/smoke*.test.ts', '**/smoke*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/index.ts',
        'src/vite-env.d.ts',
        'src/__tests__/test-helpers.ts',
      ],
      reporter: ['text', 'text-summary', 'lcov'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  }
});
