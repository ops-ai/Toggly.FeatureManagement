import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{spec,test}.{ts,tsx}'],
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
