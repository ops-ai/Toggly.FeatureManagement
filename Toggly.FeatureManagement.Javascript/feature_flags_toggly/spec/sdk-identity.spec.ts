import {
  SDK_ID,
  SDK_VERSION,
  buildDefinitionFetchHeaders,
  sdkUserAgent,
  sdkCustomHeaders,
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
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      expect(headers['X-Toggly-Sdk']).toBe(SDK_ID);
      expect(headers['X-Toggly-Sdk-Version']).toBe(SDK_VERSION);
      expect(headers['User-Agent']).toBeUndefined();
    } else {
      expect(headers['User-Agent']).toBe(`toggly-${SDK_ID}/${SDK_VERSION}`);
      expect(headers['X-Toggly-Sdk']).toBeUndefined();
    }
    expect(headers.Accept).toBe('application/json');
  });
});
