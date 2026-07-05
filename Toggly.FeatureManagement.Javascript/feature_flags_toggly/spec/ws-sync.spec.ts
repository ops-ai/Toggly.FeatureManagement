import {
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
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
});
