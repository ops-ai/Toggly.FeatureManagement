import { describe, it, expect } from 'vitest'
import {
  DEFINITIONS_REVISION_HEADER,
  WS_RECONNECT_BASE_MS,
  WS_RECONNECT_MAX_MS,
  buildWebSocketUrl,
  getNextReconnectDelayMs,
  shouldFetchOnSync,
  appendDefinitionsRevisionParam,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  extractDefinitionsRevision,
} from '../src/ws-sync'

describe('ws-sync', () => {
  describe('buildWebSocketUrl', () => {
    it('builds wss url with revision and sdk query params', () => {
      const url = buildWebSocketUrl('https://definitions.toggly.io/', 'app-key', 'abc123')
      expect(url.startsWith('wss://definitions.toggly.io/app-key/ws?')).toBe(true)
      const params = new URL(url).searchParams
      expect(params.get('rev')).toBe('abc123')
      expect(params.get('sdk')).toBe('node')
      expect(params.get('sdkVersion')).toBeTruthy()
    })

    it('builds ws url without rev when etag is null', () => {
      const url = buildWebSocketUrl('http://localhost:8787', 'app-key', null)
      expect(url.startsWith('ws://localhost:8787/app-key/ws?')).toBe(true)
      expect(new URL(url).searchParams.get('rev')).toBeNull()
    })
  })

  describe('getNextReconnectDelayMs', () => {
    it('uses exponential backoff capped at max', () => {
      expect(getNextReconnectDelayMs(0)).toBe(WS_RECONNECT_BASE_MS)
      expect(getNextReconnectDelayMs(1)).toBe(WS_RECONNECT_BASE_MS * 2)
      expect(getNextReconnectDelayMs(10)).toBe(WS_RECONNECT_MAX_MS)
    })
  })

  describe('shouldFetchOnSync', () => {
    it('returns false for non-sync messages', () => {
      expect(shouldFetchOnSync({ type: 'ping' }, null)).toBe(false)
    })

    it('returns false when unchanged', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'abc', unchanged: true }, 'abc')).toBe(false)
    })

    it('returns true when there is no cached etag', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'new' }, null)).toBe(true)
    })

    it('returns true when etag differs', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'new' }, 'old')).toBe(true)
    })

    it('returns false when etag matches', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'same' }, 'same')).toBe(false)
    })
  })

  describe('shouldFetchOnFlagsUpdated', () => {
    it('returns false for unrelated message types', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'sync' }, 'etag')).toBe(false)
    })

    it('returns true for flags-updated without etag comparison data', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'flags-updated' }, null)).toBe(true)
      expect(shouldFetchOnFlagsUpdated({ type: 'update', etag: 'x' }, null)).toBe(true)
    })

    it('compares etags when both are present', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'flags-updated', etag: 'new' }, 'old')).toBe(true)
      expect(shouldFetchOnFlagsUpdated({ type: 'update', etag: 'same' }, 'same')).toBe(false)
    })
  })

  describe('shouldFetchOnSigningKeyUpdated', () => {
    it('detects signing-key-updated messages', () => {
      expect(shouldFetchOnSigningKeyUpdated({ type: 'signing-key-updated' })).toBe(true)
      expect(shouldFetchOnSigningKeyUpdated({ type: 'sync' })).toBe(false)
    })
  })

  describe('extractDefinitionsRevision', () => {
    it('prefers X-Definitions-Revision over ETag', () => {
      const response = {
        headers: {
          get: (name: string) => {
            if (name === DEFINITIONS_REVISION_HEADER) return 'rev-1'
            if (name === 'ETag') return 'etag-1'
            return null
          },
        },
      } as Response
      expect(extractDefinitionsRevision(response)).toBe('rev-1')
    })

    it('falls back to ETag', () => {
      const response = {
        headers: {
          get: (name: string) => (name === 'ETag' ? 'etag-1' : null),
        },
      } as Response
      expect(extractDefinitionsRevision(response)).toBe('etag-1')
    })

    it('returns null when headers are missing', () => {
      expect(extractDefinitionsRevision({} as Response)).toBeNull()
    })
  })
})

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

