export const SDK_ID = 'nuxt';
export const SDK_VERSION = '1.3.1';

export const SDK_HEADER_ID = 'X-Toggly-Sdk';
export const SDK_HEADER_VERSION = 'X-Toggly-Sdk-Version';

export function sdkUserAgent(): string {
  return `toggly-${SDK_ID}/${SDK_VERSION}`;
}

export function sdkCustomHeaders(): Record<string, string> {
  return {
    [SDK_HEADER_ID]: SDK_ID,
    [SDK_HEADER_VERSION]: SDK_VERSION,
  };
}

export function appendSdkQueryParams(params: URLSearchParams): void {
  params.set('sdk', SDK_ID);
  params.set('sdkVersion', SDK_VERSION);
}

/** Browser and React Native use custom headers on HTTP (User-Agent is forbidden in browser fetch). */
export function usesSdkCustomHeaders(): boolean {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return true;
  }
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    return true;
  }
  return false;
}

export function buildDefinitionFetchHeaders(existing: Record<string, string> = {}): Record<string, string> {
  const headers = { ...existing };
  if (usesSdkCustomHeaders()) {
    Object.assign(headers, sdkCustomHeaders());
  } else {
    headers['User-Agent'] = sdkUserAgent();
  }
  return headers;
}
