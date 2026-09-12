const { webcrypto } = require('node:crypto');
const { TextDecoder, TextEncoder } = require('node:util');

Object.defineProperties(globalThis, {
  crypto: { configurable: true, value: webcrypto, writable: true },
  TextDecoder: { configurable: true, value: TextDecoder, writable: true },
  TextEncoder: { configurable: true, value: TextEncoder, writable: true },
});
