import {
  SDK_ID,
  SDK_VERSION,
  appendSdkQueryParams,
  buildDefinitionFetchHeaders,
  sdkCustomHeaders,
  sdkUserAgent,
} from './sdk-identity';

describe('sdk-identity', () => {
  it('builds sdk user agent string', () => {
    expect(sdkUserAgent()).toBe(`toggly-${SDK_ID}/${SDK_VERSION}`);
  });

  it('returns sdk custom headers', () => {
    expect(sdkCustomHeaders()).toEqual({
      'X-Toggly-Sdk': SDK_ID,
      'X-Toggly-Sdk-Version': SDK_VERSION,
    });
  });

  it('appends sdk query params', () => {
    const params = new URLSearchParams();
    appendSdkQueryParams(params);
    expect(params.get('sdk')).toBe(SDK_ID);
    expect(params.get('sdkVersion')).toBe(SDK_VERSION);
  });

  it('uses custom headers in browser fetch', () => {
    const headers = buildDefinitionFetchHeaders({ Accept: 'application/json' });
    expect(headers['X-Toggly-Sdk']).toBe(SDK_ID);
    expect(headers.Accept).toBe('application/json');
  });
});
