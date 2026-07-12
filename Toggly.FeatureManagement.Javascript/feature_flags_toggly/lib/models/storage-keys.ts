const CACHE_PREFIX = 'toggly:';

export const StorageKeys = {
  identityKey: `${CACHE_PREFIX}identity`,
  groupsKey: `${CACHE_PREFIX}groups`,
  claimsKey: `${CACHE_PREFIX}claims`,
  /** Sidecar LRU index for identity-scoped flags/variants cache keys. */
  cacheLruKey: `${CACHE_PREFIX}cache-lru`,
  flagsCacheKey(appKey: string, environment: string, contextKey = ''): string {
    const suffix = contextKey ? `:${contextKey}` : '';
    return `${CACHE_PREFIX}flags:${appKey}:${environment}${suffix}`;
  },
  variantsCacheKey(appKey: string, environment: string, contextKey = ''): string {
    const suffix = contextKey ? `:${contextKey}` : '';
    return `${CACHE_PREFIX}variants:${appKey}:${environment}${suffix}`;
  },
  definitionsRevisionCacheKey(appKey: string, environment: string): string {
    return `${CACHE_PREFIX}revision:${appKey}:${environment}`;
  },
};
