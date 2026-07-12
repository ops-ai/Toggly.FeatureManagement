export interface CacheLruEntry {
    lastAccessed: number;
}
export interface CacheLruIndex {
    entries: Record<string, CacheLruEntry>;
}
export declare function emptyCacheLruIndex(): CacheLruIndex;
export declare function parseCacheLruIndex(raw: string | null | undefined): CacheLruIndex;
export declare function serializeCacheLruIndex(index: CacheLruIndex): string;
export declare function touchCacheLruKey(index: CacheLruIndex, key: string, now?: number): CacheLruIndex;
export declare function removeCacheLruKeys(index: CacheLruIndex, keys: string[]): CacheLruIndex;
/**
 * Oldest keys to remove so the index length is at most `maxKeys`.
 *
 * Skips keys in `protectKeys` / `protectKey` (typically the key(s) just written
 * for the same evaluation context — e.g. flags + variants siblings).
 */
export declare function selectCacheLruKeysToEvict(index: CacheLruIndex, maxKeys: number, options?: {
    protectKey?: string;
    protectKeys?: string[];
}): string[];
/** True when a positive finite max is configured. */
export declare function isCacheLruEnabled(maxCacheKeys: number | null | undefined): boolean;
