import baseConfig from './jest.config.js';

export default {
  ...baseConfig,
  collectCoverage: false,
  coverageThreshold: undefined,
  testMatch: ['**/src/smoke*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  testEnvironment: 'node',
};
