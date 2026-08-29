import { describe, it, expect } from 'vitest';
import {
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  shouldFetchOnSync,
  DEFINITIONS_REVISION_HEADER,
} from '../../client/ws-sync.js';
import { SDK_ID, SDK_VERSION } from '../../sdk-identity.js';

describe('ws-sync', () => {
  describe('buildWebSocketUrl', () => {
    it('appends rev and sdk query params when cached etag exists', () => {
      expect(buildWebSocketUrl('https://definitions.toggly.io', 'app-key', 'abc123')).toBe(
        `wss://definitions.toggly.io/app-key/ws?rev=abc123&sdk=${SDK_ID}&sdkVersion=${SDK_VERSION}`
      );
    });

    it('appends sdk query params when no cached etag', () => {
      expect(buildWebSocketUrl('https://definitions.toggly.io', 'app-key', null)).toBe(
        `wss://definitions.toggly.io/app-key/ws?sdk=${SDK_ID}&sdkVersion=${SDK_VERSION}`
      );
    });

    it('converts http to ws and strips trailing slash', () => {
      expect(buildWebSocketUrl('http://localhost:8787/', 'app-key', null)).toBe(
        `ws://localhost:8787/app-key/ws?sdk=${SDK_ID}&sdkVersion=${SDK_VERSION}`
      );
    });
  });

  describe('getNextReconnectDelayMs', () => {
    it('exponentially backs off up to the max delay', () => {
      expect(getNextReconnectDelayMs(0)).toBe(5000);
      expect(getNextReconnectDelayMs(1)).toBe(10000);
      expect(getNextReconnectDelayMs(10)).toBe(60000);
    });
  });

  describe('shouldFetchOnSync', () => {
    it('returns false for non-sync messages', () => {
      expect(shouldFetchOnSync({ type: 'flags-updated', etag: 'abc' }, null)).toBe(false);
    });

    it('skips fetch when unchanged is true', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'abc', unchanged: true }, 'abc')).toBe(false);
    });

    it('fetches when there is no cached etag', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'abc' }, null)).toBe(true);
    });

    it('fetches when etag differs from cache', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'new' }, 'old')).toBe(true);
    });

    it('skips fetch when etag matches cache', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'abc' }, 'abc')).toBe(false);
    });

    it('skips fetch when sync has no etag but cache exists', () => {
      expect(shouldFetchOnSync({ type: 'sync' }, 'abc')).toBe(false);
    });
  });

  describe('shouldFetchOnFlagsUpdated', () => {
    it('returns false for unrelated message types', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'sync', etag: 'new' }, 'old')).toBe(false);
    });

    it('supports legacy update type', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'update', etag: 'new' }, 'old')).toBe(true);
    });

    it('fetches when message has no etag', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'flags-updated' }, 'old')).toBe(true);
    });

    it('fetches when cache is empty', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'flags-updated', etag: 'new' }, null)).toBe(true);
    });

    it('skips fetch when etag matches cache', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'flags-updated', etag: 'same' }, 'same')).toBe(false);
    });
  });

  describe('shouldFetchOnSigningKeyUpdated', () => {
    it('returns true for signing-key-updated', () => {
      expect(shouldFetchOnSigningKeyUpdated({ type: 'signing-key-updated' })).toBe(true);
    });

    it('returns false for other types', () => {
      expect(shouldFetchOnSigningKeyUpdated({ type: 'flags-updated' })).toBe(false);
    });
  });

  describe('extractDefinitionsRevision', () => {
    it('reads X-Definitions-Revision header', () => {
      const response = {
        headers: {
          get: (key: string) => (key === DEFINITIONS_REVISION_HEADER ? 'rev-abc' : null),
        },
      } as Response;
      expect(extractDefinitionsRevision(response)).toBe('rev-abc');
    });

    it('falls back to ETag header', () => {
      const response = {
        headers: {
          get: (key: string) => (key === 'ETag' ? '"etag-1"' : null),
        },
      } as Response;
      expect(extractDefinitionsRevision(response)).toBe('"etag-1"');
    });

    it('returns null when headers are missing', () => {
      expect(extractDefinitionsRevision({} as Response)).toBeNull();
    });
  });
});
