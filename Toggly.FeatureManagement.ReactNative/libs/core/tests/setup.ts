// Jest setup file
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

// Mock fetch for tests
global.fetch = jest.fn();

// Real WebCrypto — do not stub digest/verify (signed defs tests need them).
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});

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

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
