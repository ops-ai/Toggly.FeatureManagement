export const SDK_ID = 'docusaurus';
export const SDK_VERSION = '0.10.3';

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

type BrowserLikeGlobal = typeof globalThis & {
  window?: unknown;
  document?: unknown;
  navigator?: { product?: string };
};

export function usesSdkCustomHeaders(): boolean {
  const g = globalThis as BrowserLikeGlobal;
  if (g.window !== undefined && g.document !== undefined) {
    return true;
  }
  if (g.navigator?.product === 'ReactNative') {
    return true;
  }
  return false;
}

export function buildDefinitionFetchHeaders(
  existing: Record<string, string> = {},
): Record<string, string> {
  const headers = { ...existing };
  if (usesSdkCustomHeaders()) {
    Object.assign(headers, sdkCustomHeaders());
  } else {
    headers['User-Agent'] = sdkUserAgent();
  }
  return headers;
}
