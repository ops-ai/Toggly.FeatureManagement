/**
 * Jest setup file for client tests
 */

import { TextDecoder, TextEncoder } from 'node:util';
import '@testing-library/jest-dom';

// jsdom lacks TextEncoder; core telemetry hash.ts needs it at module load.
if (typeof globalThis.TextEncoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextEncoder', {
    value: TextEncoder,
    configurable: true,
  });
}
if (typeof globalThis.TextDecoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextDecoder', {
    value: TextDecoder,
    configurable: true,
  });
}

// Mock fetch globally
global.fetch = jest.fn();

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
  (global.fetch as jest.Mock).mockReset();
  // Reset toggly data between tests
  (window as unknown as Record<string, unknown>).__TOGGLY_DATA__ = undefined;
});
