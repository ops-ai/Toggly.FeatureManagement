import { Toggly } from '../lib/toggly';

/**
 * Exercises anonymous identity minting when randomUUID is unavailable
 * (non-localhost HTTP origins expose getRandomValues only).
 */
describe('anonymous identity without randomUUID', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
    Toggly.cancelRefreshInterval();
    jest.restoreAllMocks();
  });

  test('falls back to getRandomValues UUID v4 when randomUUID is missing', async () => {
    const getRandomValues = jest.fn((buffer: Uint8Array) => {
      for (let i = 0; i < buffer.length; i++) buffer[i] = i;
      return buffer;
    });
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues },
      configurable: true,
      writable: true,
    });

    Toggly.clearIdentity();
    await Toggly.init({
      flagDefaults: { Feature: true },
      featureFlagsRefreshInterval: 0,
      enableLiveUpdates: false,
      enableTelemetry: false,
      persistCache: false,
    });

    expect(getRandomValues).toHaveBeenCalled();
    expect(Toggly.identity).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(Toggly.isFeatureOn('Feature')).toBe(true);
  });
});
