export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.webcrypto.setup.cjs'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        allowJs: true,
      }
    }]
  },
  transformIgnorePatterns: ['/node_modules/(?!@ops-ai/toggly-signed-defs/)'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.spec.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/index.ts',
    '!src/test-helpers.ts',
  ],
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 85,
      functions: 90,
      lines: 90,
    },
  },
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/src/**/*.spec.tsx',
  ],
  testPathIgnorePatterns: ['/node_modules/', '.*smoke.*\\.spec\\.ts$', '.*smoke.*\\.spec\\.tsx$', '.*smoke.*\\.test\\.ts$', '.*smoke.*\\.test\\.tsx$'],
};
