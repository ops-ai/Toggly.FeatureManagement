import { appendSdkQueryParams } from './sdk-identity.js';

export const DEFINITIONS_REVISION_HEADER = 'X-Definitions-Revision';

export const WS_RECONNECT_BASE_MS = 5000;
export const WS_RECONNECT_MAX_MS = 60000;
export const REFRESH_DEBOUNCE_MS = 300;

export interface WsSyncMessage {
  type: string;
  etag?: string;
  lastUpdated?: number;
  unchanged?: boolean;
  kid?: string;
}

export function buildWebSocketUrl(baseUri: string, appKey: string, cachedEtag: string | null): string {
  const wsBase = baseUri
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://')
    .replace(/\/$/, '');
  const params = new URLSearchParams();
  if (cachedEtag) {
    params.set('rev', cachedEtag);
  }
  appendSdkQueryParams(params);
  const query = params.toString();
  return `${wsBase}/${appKey}/ws${query ? `?${query}` : ''}`;
}

export function getNextReconnectDelayMs(attempt: number): number {
  return Math.min(WS_RECONNECT_BASE_MS * Math.pow(2, attempt), WS_RECONNECT_MAX_MS);
}

export function shouldFetchOnSync(message: WsSyncMessage, cachedEtag: string | null): boolean {
  if (message.type !== 'sync') {
    return false;
  }
  if (message.unchanged === true) {
    return false;
  }
  if (!cachedEtag) {
    return true;
  }
  if (message.etag && message.etag !== cachedEtag) {
    return true;
  }
  return false;
}

export function shouldFetchOnFlagsUpdated(message: WsSyncMessage, cachedEtag: string | null): boolean {
  if (message.type !== 'flags-updated' && message.type !== 'update') {
    return false;
  }
  if (!message.etag || !cachedEtag) {
    return true;
  }
  return message.etag !== cachedEtag;
}

export function shouldFetchOnSigningKeyUpdated(message: WsSyncMessage): boolean {
  return message.type === 'signing-key-updated';
}

export function extractDefinitionsRevision(response: Response): string | null {
  if (!response.headers?.get) {
    return null;
  }
  return response.headers.get(DEFINITIONS_REVISION_HEADER) ?? response.headers.get('ETag');
}


/**
 * Append `?rev=` for a cache-proof definitions GET after `flags-updated`.
 * Invariant: never cache a WebSocket etag before HTTP confirms the revision;
 * post-notify GETs should use `?rev=` and must not send If-None-Match.
 */
export function appendDefinitionsRevisionParam(
  url: string,
  rev: string | null | undefined,
): string {
  if (!rev) {
    return url;
  }
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('rev', rev);
    return parsed.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}rev=${encodeURIComponent(rev)}`;
  }
}
