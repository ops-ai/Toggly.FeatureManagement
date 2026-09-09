export declare const StorageKeys: {
    identityKey: string;
    groupsKey: string;
    claimsKey: string;
    /** Sidecar LRU index for identity-scoped flags/variants cache keys. */
    cacheLruKey: string;
    flagsCacheKey(appKey: string, environment: string, contextKey?: string): string;
    variantsCacheKey(appKey: string, environment: string, contextKey?: string): string;
    definitionsRevisionCacheKey(appKey: string, environment: string, contextKey?: string): string;
};
