import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/smoke*.test.ts', '**/smoke*.spec.ts'],
    // Avoid dialing real gRPC during unit tests unless a test opts in explicitly.
    env: {
      TOGGLY_DISABLE_TELEMETRY: '1',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      // Exclude package barrel only — telemetry/index.ts is runtime logic Sonar scores.
      exclude: ['src/**/*.d.ts', 'src/index.ts', 'src/**/types.ts'],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 70,
        statements: 75,
      },
    },
  },
})
