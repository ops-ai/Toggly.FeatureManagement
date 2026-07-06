import {
  SDK_ID,
  SDK_VERSION,
  buildDefinitionFetchHeaders,
  sdkCustomHeaders,
  sdkUserAgent,
  usesSdkCustomHeaders,
} from '../src/sdk-identity';

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

  it('buildDefinitionFetchHeaders uses User-Agent on server', () => {
    const headers = buildDefinitionFetchHeaders({ Accept: 'application/json' });
    expect(headers['User-Agent']).toBe(`toggly-${SDK_ID}/${SDK_VERSION}`);
    expect(headers['X-Toggly-Sdk']).toBeUndefined();
    expect(headers['Accept']).toBe('application/json');
  });

  it('usesSdkCustomHeaders is true in browser-like environments', () => {
    const g = globalThis as typeof globalThis & { window?: unknown; document?: unknown };
    const prevWindow = g.window;
    const prevDocument = g.document;
    g.window = {};
    g.document = {};
    expect(usesSdkCustomHeaders()).toBe(true);
    const headers = buildDefinitionFetchHeaders();
    expect(headers['X-Toggly-Sdk']).toBe(SDK_ID);
    g.window = prevWindow;
    g.document = prevDocument;
  });

  it('usesSdkCustomHeaders is true for ReactNative navigator', () => {
    const g = globalThis as typeof globalThis & {
      window?: unknown;
      document?: unknown;
      navigator?: { product?: string };
    };
    const prevWindow = g.window;
    const prevDocument = g.document;
    const prevNavigator = g.navigator;
    delete g.window;
    delete g.document;
    g.navigator = { product: 'ReactNative' };
    expect(usesSdkCustomHeaders()).toBe(true);
    g.window = prevWindow;
    g.document = prevDocument;
    g.navigator = prevNavigator;
  });
});
