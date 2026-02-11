/**
 * Jest setup file for client tests
 */

import '@testing-library/jest-dom';

// Mock fetch globally
global.fetch = jest.fn();

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
  (global.fetch as jest.Mock).mockReset();
  // Reset toggly data between tests
  (window as unknown as Record<string, unknown>).__TOGGLY_DATA__ = undefined;
});
