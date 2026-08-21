import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, configDefaults } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const signedDefsSrc = path.resolve(rootDir, '../../toggly-signed-defs/src/index.ts');

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@ops-ai/toggly-signed-defs': signedDefsSrc,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: [...configDefaults.exclude, 'node_modules', 'dist', 'example', '**/smoke*.test.ts', '**/smoke*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,vue}', '../../toggly-signed-defs/src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/index.ts',
        'src/vite-env.d.ts',
        'src/__tests__/test-helpers.ts',
        '../../toggly-signed-defs/src/**/*.test.ts',
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
