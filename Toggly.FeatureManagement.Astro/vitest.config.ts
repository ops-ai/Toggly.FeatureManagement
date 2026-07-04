import { resolve } from 'node:path';

import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@ops-ai/toggly-local-gates': resolve(__dirname, '../toggly-local-gates/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{spec,test}.{ts,tsx}'],
    exclude: [...configDefaults.exclude, '**/smoke*.test.ts', '**/smoke*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.test.ts',
        'src/**/*.spec.tsx',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/types/**',
        'src/index.ts',
        'src/frameworks/react/index.ts',
        'src/frameworks/vue/index.ts',
        'src/frameworks/svelte/index.ts',
        'src/components/**/*.astro',
        'src/frameworks/vue/**/*.vue',
        'src/frameworks/svelte/**/*.svelte',
      ],
      reporter: ['text', 'text-summary', 'lcov'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
      },
    },
  },
});
