import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [solid()],
        test: {
          name: 'browser',
          setupFiles: ['tests/setup.ts'],
          environment: 'jsdom',
          include: ['tests/*.test.ts', 'tests/*.test.tsx'],
          exclude: ['tests/server.test.ts', 'tests/native-ssr.test.tsx'],
        },
      },
      {
        plugins: [solid({ ssr: true })],
        resolve: { conditions: ['node'] },
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server.test.ts', 'tests/native-ssr.test.tsx'],
        },
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
