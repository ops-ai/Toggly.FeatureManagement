export declare const DEFINITIONS_REVISION_HEADER = "X-Definitions-Revision";
export declare const WS_RECONNECT_BASE_MS = 5000;
export declare const WS_RECONNECT_MAX_MS = 60000;
export declare const REFRESH_DEBOUNCE_MS = 300;
export interface WsSyncMessage {
    type: string;
    etag?: string;
    lastUpdated?: number;
    unchanged?: boolean;
    kid?: string;
}
export declare function buildWebSocketUrl(baseUri: string, appKey: string, cachedEtag: string | null): string;
export declare function getNextReconnectDelayMs(attempt: number): number;
export declare function shouldFetchOnSync(message: WsSyncMessage, cachedEtag: string | null): boolean;
export declare function shouldFetchOnFlagsUpdated(message: WsSyncMessage, cachedEtag: string | null): boolean;
export declare function shouldFetchOnSigningKeyUpdated(message: WsSyncMessage): boolean;
export type FlagsUpdatedRefreshPlan = {
    action: 'none';
} | {
    action: 'refresh-jwks';
} | {
    action: 'refresh-pinned';
    pin: string | null;
};
export declare function planFlagsUpdatedRefresh(message: WsSyncMessage, previousRevision: string | null): FlagsUpdatedRefreshPlan;
export declare function applyFlagsUpdatedPlan(plan: FlagsUpdatedRefreshPlan, message: WsSyncMessage, hooks: {
    refreshJwks: () => void;
    refreshPinned: (pin: string | null) => void;
    cacheEtagIfPresent: (etag: string) => void;
}): void;
export declare function extractDefinitionsRevision(response: Response): string | null;
/**
 * Append `?rev=` for a cache-proof definitions GET after `flags-updated`.
 * Invariant: never cache a WebSocket etag before HTTP confirms the revision;
 * post-notify GETs should use `?rev=` and must not send If-None-Match.
 */
export declare function appendDefinitionsRevisionParam(url: string, rev: string | null | undefined): string;
