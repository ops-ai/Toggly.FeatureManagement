export const SDK_ID = 'electron'
export const SDK_VERSION = '1.0.0'

export const SDK_HEADER_ID = 'X-Toggly-Sdk'
export const SDK_HEADER_VERSION = 'X-Toggly-Sdk-Version'

export function sdkUserAgent(): string {
  return `toggly-${SDK_ID}/${SDK_VERSION}`
}

export function sdkCustomHeaders(): Record<string, string> {
  return {
    [SDK_HEADER_ID]: SDK_ID,
    [SDK_HEADER_VERSION]: SDK_VERSION,
  }
}

export function appendSdkQueryParams(params: URLSearchParams): void {
  params.set('sdk', SDK_ID)
  params.set('sdkVersion', SDK_VERSION)
}

export function buildDefinitionFetchHeaders(
  existing: Record<string, string> = {},
): Record<string, string> {
  return {
    ...existing,
    'User-Agent': sdkUserAgent(),
    ...sdkCustomHeaders(),
  }
}
