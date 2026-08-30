import { describe, it, expect } from 'vitest';
import {
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  appendDefinitionsRevisionParam,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  shouldFetchOnSync,
  DEFINITIONS_REVISION_HEADER,
} from '../../utils/ws-sync.js';
import { SDK_VERSION } from '../../sdk-identity.js';

describe('ws-sync', () => {
  describe('buildWebSocketUrl', () => {
    it('appends rev and sdk query params when cached etag exists', () => {
      expect(buildWebSocketUrl('https://definitions.toggly.io', 'app-key', 'abc123')).toBe(
        `wss://definitions.toggly.io/app-key/ws?rev=abc123&sdk=gatsby&sdkVersion=${SDK_VERSION}`,
      );
    });

    it('appends sdk query params when no cached etag', () => {
      expect(buildWebSocketUrl('https://definitions.toggly.io', 'app-key', null)).toBe(
        `wss://definitions.toggly.io/app-key/ws?sdk=gatsby&sdkVersion=${SDK_VERSION}`,
      );
    });

    it('converts http to ws', () => {
      expect(buildWebSocketUrl('http://localhost:8787/', 'key', 'rev1')).toBe(
        `ws://localhost:8787/key/ws?rev=rev1&sdk=gatsby&sdkVersion=${SDK_VERSION}`,
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
    it('skips fetch when unchanged is true', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'abc', unchanged: true }, 'abc')).toBe(false);
    });

    it('fetches when no cached revision', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'abc' }, null)).toBe(true);
    });

    it('fetches when etag differs from cache', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'new' }, 'old')).toBe(true);
    });

    it('skips fetch when etag matches cache', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'same' }, 'same')).toBe(false);
    });

    it('ignores non-sync messages', () => {
      expect(shouldFetchOnSync({ type: 'flags-updated', etag: 'abc' }, null)).toBe(false);
    });
  });

  describe('shouldFetchOnFlagsUpdated', () => {
    it('fetches when cached revision is missing', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'flags-updated', etag: 'abc' }, null)).toBe(true);
    });

    it('ignores unrelated message types', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'sync', etag: 'abc' }, 'old')).toBe(false);
    });

    it('skips fetch when etag matches cache', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'flags-updated', etag: 'same' }, 'same')).toBe(false);
    });

    it('supports legacy update type', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'update', etag: 'new' }, 'old')).toBe(true);
    });
  });

  describe('shouldFetchOnSigningKeyUpdated', () => {
    it('returns true for signing-key-updated', () => {
      expect(shouldFetchOnSigningKeyUpdated({ type: 'signing-key-updated', kid: 'kid-1' })).toBe(true);
    });

    it('returns false for other message types', () => {
      expect(shouldFetchOnSigningKeyUpdated({ type: 'sync' })).toBe(false);
    });
  });

  describe('extractDefinitionsRevision', () => {
    function mockResponse(headers: Record<string, string>): Response {
      return {
        headers: {
          get: (key: string) => headers[key] ?? null,
        },
      } as Response;
    }

    it('reads X-Definitions-Revision header', () => {
      const response = mockResponse({ [DEFINITIONS_REVISION_HEADER]: 'rev-abc' });
      expect(extractDefinitionsRevision(response)).toBe('rev-abc');
    });

    it('falls back to ETag header', () => {
      const response = mockResponse({ ETag: 'etag-abc' });
      expect(extractDefinitionsRevision(response)).toBe('etag-abc');
    });

    it('returns null when headers are missing', () => {
      expect(extractDefinitionsRevision({} as Response)).toBeNull();
    });
  });
});

  describe('appendDefinitionsRevisionParam', () => {
    it('appends rev query param to absolute URLs', () => {
      expect(
        appendDefinitionsRevisionParam('https://definitions.toggly.io/a/b', 'etag-1'),
      ).toBe('https://definitions.toggly.io/a/b?rev=etag-1');
    });

    it('replaces an existing rev param', () => {
      expect(
        appendDefinitionsRevisionParam('https://definitions.toggly.io/a/b?rev=old', 'new'),
      ).toBe('https://definitions.toggly.io/a/b?rev=new');
    });

    it('returns the original URL when rev is empty', () => {
      expect(appendDefinitionsRevisionParam('https://example.com/x', null)).toBe(
        'https://example.com/x',
      );
      expect(appendDefinitionsRevisionParam('https://example.com/x', undefined)).toBe(
        'https://example.com/x',
      );
    });
  });
