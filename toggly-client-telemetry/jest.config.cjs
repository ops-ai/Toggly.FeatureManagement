module.exports = {
  preset: 'ts-jest', moduleNameMapper: { '^(\.{1,2}/.*)\\.js$': '$1' }, testEnvironment: 'node', testMatch: ['**/tests/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'], coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: { global: { statements: 90, branches: 85, functions: 90, lines: 90 } },
};
