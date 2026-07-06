import {
  SDK_ID,
  SDK_VERSION,
  buildDefinitionFetchHeaders,
  sdkCustomHeaders,
  sdkUserAgent,
  usesSdkCustomHeaders,
} from './sdk-identity';

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

  it('buildDefinitionFetchHeaders preserves existing headers', () => {
    const headers = buildDefinitionFetchHeaders({ Accept: 'application/json' });
    expect(headers['Accept']).toBe('application/json');
    if (usesSdkCustomHeaders()) {
      expect(headers['X-Toggly-Sdk']).toBe(SDK_ID);
    } else {
      expect(headers['User-Agent']).toBe(`toggly-${SDK_ID}/${SDK_VERSION}`);
    }
  });

  it('usesSdkCustomHeaders is true when navigator.product is ReactNative', () => {
    const originalNavigator = (globalThis as { navigator?: { product?: string } }).navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { product: 'ReactNative' },
    });

    expect(usesSdkCustomHeaders()).toBe(true);

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });
});
