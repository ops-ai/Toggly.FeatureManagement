import { describe, it, expect, vi } from 'vitest'
import {
  DEFINITIONS_REVISION_HEADER,
  WS_RECONNECT_BASE_MS,
  WS_RECONNECT_MAX_MS,
  buildWebSocketUrl,
  getNextReconnectDelayMs,
  shouldFetchOnSync,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  appendDefinitionsRevisionParam,
  applyFlagsUpdatedPlan,
  planFlagsUpdatedRefresh,
  extractDefinitionsRevision,
} from '../src/ws-sync.js'
import { SDK_ID, SDK_VERSION } from '../src/sdk-identity.js'

describe('ws-sync', () => {
  describe('buildWebSocketUrl', () => {
    it('builds wss url with revision and sdk query params', () => {
      const url = buildWebSocketUrl('https://definitions.toggly.io/', 'app-key', 'abc123')
      expect(url.startsWith('wss://definitions.toggly.io/app-key/ws?')).toBe(true)
      const params = new URL(url).searchParams
      expect(params.get('rev')).toBe('abc123')
      expect(params.get('sdk')).toBe(SDK_ID)
      expect(params.get('sdkVersion')).toBe(SDK_VERSION)
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

  describe('signing key and plans', () => {
    it('detects signing-key-updated', () => {
      expect(shouldFetchOnSigningKeyUpdated({ type: 'signing-key-updated' })).toBe(true)
      expect(shouldFetchOnSigningKeyUpdated({ type: 'sync' })).toBe(false)
    })

    it('plans refresh actions', () => {
      expect(planFlagsUpdatedRefresh({ type: 'signing-key-updated' }, 'r')).toEqual({
        action: 'refresh-jwks',
      })
      expect(planFlagsUpdatedRefresh({ type: 'flags-updated', etag: 'n' }, 'o')).toEqual({
        action: 'refresh-pinned',
        pin: 'n',
      })
      expect(planFlagsUpdatedRefresh({ type: 'update', etag: 'same' }, 'same')).toEqual({
        action: 'none',
      })
    })

    it('applies refresh plans', () => {
      const hooks = {
        refreshJwks: vi.fn(),
        refreshPinned: vi.fn(),
        cacheEtagIfPresent: vi.fn(),
      }
      applyFlagsUpdatedPlan({ action: 'refresh-jwks' }, { type: 'signing-key-updated' }, hooks)
      expect(hooks.refreshJwks).toHaveBeenCalled()
      applyFlagsUpdatedPlan(
        { action: 'refresh-pinned', pin: 'p' },
        { type: 'flags-updated', etag: 'p' },
        hooks,
      )
      expect(hooks.refreshPinned).toHaveBeenCalledWith('p')
      applyFlagsUpdatedPlan({ action: 'none' }, { type: 'update', etag: 'keep' }, hooks)
      expect(hooks.cacheEtagIfPresent).toHaveBeenCalledWith('keep')
    })
  })

  describe('revision helpers', () => {
    it('extractDefinitionsRevision reads headers', () => {
      const response = {
        headers: {
          get: (name: string) =>
            name === DEFINITIONS_REVISION_HEADER ? 'rev-123' : null,
        },
      } as Response
      expect(extractDefinitionsRevision(response)).toBe('rev-123')
      expect(extractDefinitionsRevision({} as Response)).toBeNull()
    })

    it('appendDefinitionsRevisionParam mutates query', () => {
      expect(appendDefinitionsRevisionParam('https://example.com/a', null)).toBe(
        'https://example.com/a',
      )
      expect(appendDefinitionsRevisionParam('https://example.com/a', 'r1')).toBe(
        'https://example.com/a?rev=r1',
      )
      expect(appendDefinitionsRevisionParam('https://example.com/a?rev=old', 'new')).toBe(
        'https://example.com/a?rev=new',
      )
      expect(appendDefinitionsRevisionParam('not a url', 'x')).toContain('rev=x')
    })
  })
})
