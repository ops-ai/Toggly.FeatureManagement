/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFiles: ['./spec/setup-fetch.js'],
  collectCoverageFrom: [
    'lib/**/*.ts',
    '!lib/models/index.ts',
    // Type-only browser declaration entry: no executable code to instrument.
    '!lib/feature-flags-toggly.bundle.ts',
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
