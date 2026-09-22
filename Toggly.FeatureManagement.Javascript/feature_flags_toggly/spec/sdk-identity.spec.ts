import {
  SDK_ID,
  SDK_VERSION,
  buildDefinitionFetchHeaders,
  sdkUserAgent,
  sdkCustomHeaders,
  usesSdkCustomHeaders,
} from '../lib/sdk-identity';

describe('sdk-identity', () => {
  it('sdkUserAgent uses toggly prefix format', () => {
    expect(sdkUserAgent()).toBe(`toggly-${SDK_ID}/${SDK_VERSION}`);
  });

  it('sdkCustomHeaders exposes X-Toggly headers', () => {
    expect(sdkCustomHeaders()).toEqual({
      'X-Toggly-Sdk': SDK_ID,
      'X-Toggly-Sdk-Version': SDK_VERSION,
    });
  });

  it('buildDefinitionFetchHeaders adds SDK identity to existing headers', () => {
    const headers = buildDefinitionFetchHeaders({ Accept: 'application/json' });
    if (usesSdkCustomHeaders()) {
      expect(headers['X-Toggly-Sdk']).toBe(SDK_ID);
      expect(headers['X-Toggly-Sdk-Version']).toBe(SDK_VERSION);
      expect(headers['User-Agent']).toBeUndefined();
    } else {
      expect(headers['User-Agent']).toBe(`toggly-${SDK_ID}/${SDK_VERSION}`);
      expect(headers['X-Toggly-Sdk']).toBeUndefined();
    }
    expect(headers.Accept).toBe('application/json');
  });

  it('usesSdkCustomHeaders is true when navigator.product is ReactNative', () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { product: 'ReactNative' },
    });
    try {
      expect(usesSdkCustomHeaders()).toBe(true);
    } finally {
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

});
