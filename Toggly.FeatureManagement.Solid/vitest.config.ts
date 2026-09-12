import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [solid()],
        test: {
          name: 'browser',
          environment: 'jsdom',
          include: ['tests/*.test.ts', 'tests/*.test.tsx'],
          exclude: ['tests/server.test.ts'],
        },
      },
      {
        resolve: { conditions: ['node'] },
        test: { name: 'server', environment: 'node', include: ['tests/server.test.ts'] },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      thresholds: { statements: 91, branches: 91, functions: 91, lines: 91 },
    },
  },
});
