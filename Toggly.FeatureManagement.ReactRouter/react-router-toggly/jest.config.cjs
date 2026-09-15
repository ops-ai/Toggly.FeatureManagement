/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  projects: [
    {
      displayName: 'core',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src/core', '<rootDir>/tests/core'],
      setupFiles: ['<rootDir>/tests/core/setup-module-url.cjs'],
      testMatch: ['**/*.spec.ts', '**/*.test.ts'],
      testPathIgnorePatterns: ['/node_modules/', '.*smoke.*'],
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
      },
    },
    {
      displayName: 'server',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src/server', '<rootDir>/tests/server'],
      setupFiles: ['<rootDir>/tests/core/setup-module-url.cjs'],
      testMatch: ['**/*.spec.ts', '**/*.test.ts'],
      testPathIgnorePatterns: ['/node_modules/', '.*smoke.*'],
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
      },
    },
    {
      displayName: 'client',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      roots: ['<rootDir>/src/client', '<rootDir>/tests/client'],
      setupFilesAfterEnv: ['<rootDir>/tests/client/setup.ts'],
      testMatch: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
      testPathIgnorePatterns: ['/node_modules/', '.*smoke.*'],
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
      },
    },
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/core/telemetry/public.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.spec.tsx',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 88,
      functions: 90,
      lines: 90,
    },
  },
  verbose: true,
};

module.exports = config;
