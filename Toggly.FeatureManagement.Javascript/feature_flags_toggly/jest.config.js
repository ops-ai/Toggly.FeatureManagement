/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFiles: ['./spec/setup-fetch.js'],
  moduleNameMapper: {
    // Resolve shared crypto to source so coverage stays accurate after extracting vendors.
    '^@ops-ai/toggly-signed-defs$': '<rootDir>/../../toggly-signed-defs/src/index.ts',
  },
  collectCoverageFrom: [
    'lib/**/*.ts',
    '!lib/models/index.ts',
    '../../toggly-signed-defs/src/**/*.ts',
    '!../../toggly-signed-defs/src/**/*.test.ts',
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
  testPathIgnorePatterns: ['/node_modules/', '.*smoke.*\\.spec\\.ts$', '.*smoke.*\\.test\\.ts$'],
};