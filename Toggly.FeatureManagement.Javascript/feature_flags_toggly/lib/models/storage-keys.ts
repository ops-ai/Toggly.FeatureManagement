const CACHE_PREFIX = 'toggly:';

export const StorageKeys = {
  identityKey: `${CACHE_PREFIX}identity`,
  flagsCacheKey(appKey: string, environment: string): string {
    return `${CACHE_PREFIX}flags:${appKey}:${environment}`;
  },
  variantsCacheKey(appKey: string, environment: string): string {
    return `${CACHE_PREFIX}variants:${appKey}:${environment}`;
  },
};
