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
export declare function extractDefinitionsRevision(response: Response): string | null;
