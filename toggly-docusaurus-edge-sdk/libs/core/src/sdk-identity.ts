export const SDK_ID = 'client-core';
export const SDK_VERSION = '0.5.3';

export const SDK_HEADER_ID = 'X-Toggly-Sdk';
export const SDK_HEADER_VERSION = 'X-Toggly-Sdk-Version';

const DEFAULT_SDK = { id: SDK_ID, version: SDK_VERSION };

export function sdkUserAgent(
  sdkId: string = SDK_ID,
  sdkVersion: string = SDK_VERSION,
): string {
  return `toggly-${sdkId}/${sdkVersion}`;
}

export function sdkCustomHeaders(
  sdkId: string = SDK_ID,
  sdkVersion: string = SDK_VERSION,
): Record<string, string> {
  return {
    [SDK_HEADER_ID]: sdkId,
    [SDK_HEADER_VERSION]: sdkVersion,
  };
}

type BrowserLikeGlobal = typeof globalThis & {
  window?: unknown;
  document?: unknown;
  navigator?: { product?: string };
};

/** Browser and React Native use custom headers on HTTP (User-Agent is forbidden in browser fetch). */
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
  sdk: { id: string; version: string } = DEFAULT_SDK,
): Record<string, string> {
  const headers = { ...existing };
  if (usesSdkCustomHeaders()) {
    Object.assign(headers, sdkCustomHeaders(sdk.id, sdk.version));
  } else {
    headers['User-Agent'] = sdkUserAgent(sdk.id, sdk.version);
  }
  return headers;
}
