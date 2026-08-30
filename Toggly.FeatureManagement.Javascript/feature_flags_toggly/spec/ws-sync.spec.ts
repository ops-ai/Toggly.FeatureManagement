import {
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  appendDefinitionsRevisionParam,
  planFlagsUpdatedRefresh,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  shouldFetchOnSync,
  DEFINITIONS_REVISION_HEADER,
} from '../lib/ws-sync';

describe('ws-sync', () => {
  describe('buildWebSocketUrl', () => {
    it('appends rev and sdk query params when cached etag exists', () => {
      expect(buildWebSocketUrl('https://definitions.toggly.io', 'app-key', 'abc123'))
        .toBe('wss://definitions.toggly.io/app-key/ws?rev=abc123&sdk=javascript&sdkVersion=1.3.1');
    });

    it('appends sdk query params when no cached etag', () => {
      expect(buildWebSocketUrl('https://definitions.toggly.io', 'app-key', null))
        .toBe('wss://definitions.toggly.io/app-key/ws?sdk=javascript&sdkVersion=1.3.1');
    });
  });

  describe('getNextReconnectDelayMs', () => {
    it('exponentially backs off up to the max delay', () => {
      expect(getNextReconnectDelayMs(0)).toBe(5000);
      expect(getNextReconnectDelayMs(10)).toBe(60000);
    });
  });

  describe('shouldFetchOnSync', () => {
    it('skips fetch when unchanged is true', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'abc', unchanged: true }, 'abc')).toBe(false);
    });

    it('fetches when etag differs from cache', () => {
      expect(shouldFetchOnSync({ type: 'sync', etag: 'new' }, 'old')).toBe(true);
    });
  });

  describe('shouldFetchOnFlagsUpdated', () => {
    it('supports legacy update type', () => {
      expect(shouldFetchOnFlagsUpdated({ type: 'update', etag: 'new' }, 'old')).toBe(true);
    });
  });

  describe('shouldFetchOnSigningKeyUpdated', () => {
    it('returns true for signing-key-updated', () => {
      expect(shouldFetchOnSigningKeyUpdated({ type: 'signing-key-updated' })).toBe(true);
    });
  });

  describe('planFlagsUpdatedRefresh', () => {
    it('plans JWKS refresh for signing-key-updated', () => {
      expect(planFlagsUpdatedRefresh({ type: 'signing-key-updated' }, 'old')).toEqual({
        action: 'refresh-jwks',
      });
    });

    it('plans pinned refresh when flags-updated etag differs', () => {
      expect(planFlagsUpdatedRefresh({ type: 'flags-updated', etag: 'new' }, 'old')).toEqual({
        action: 'refresh-pinned',
        pin: 'new',
      });
    });

    it('plans none when etag matches cached revision', () => {
      expect(planFlagsUpdatedRefresh({ type: 'flags-updated', etag: 'same' }, 'same')).toEqual({
        action: 'none',
      });
    });

    it('plans pinned refresh with null pin when etag is missing', () => {
      expect(planFlagsUpdatedRefresh({ type: 'update' }, 'cached')).toEqual({
        action: 'refresh-pinned',
        pin: null,
      });
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

    it('appends rev to relative URLs via the catch path', () => {
      expect(appendDefinitionsRevisionParam('/relative/path', 'etag-1')).toContain('rev=etag-1');
      expect(appendDefinitionsRevisionParam('/relative?x=1', 'etag-1')).toContain('&rev=');
    });
  });
});
