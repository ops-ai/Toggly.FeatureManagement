require('cross-fetch/polyfill');

const { webcrypto } = require('node:crypto');
const { TextEncoder, TextDecoder } = require('node:util');

// Force Node WebCrypto — jsdom may expose an incomplete crypto.subtle.
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});

Object.defineProperty(globalThis, 'TextEncoder', {
  value: TextEncoder,
  configurable: true,
});
Object.defineProperty(globalThis, 'TextDecoder', {
  value: TextDecoder,
  configurable: true,
});
