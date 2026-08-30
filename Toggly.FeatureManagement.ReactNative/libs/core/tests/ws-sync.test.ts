import {
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  appendDefinitionsRevisionParam,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  shouldFetchOnSync,
} from '../src/ws-sync';

describe('ws-sync', () => {
  it('buildWebSocketUrl converts http(s) to ws(s) and appends sdk params', () => {
    const url = buildWebSocketUrl('https://api.toggly.io', 'app-key', 'rev-1');
    expect(url).toBe(
      'wss://api.toggly.io/app-key/ws?rev=rev-1&sdk=react-native&sdkVersion=1.3.1'
    );
  });

  it('getNextReconnectDelayMs applies exponential backoff with cap', () => {
    expect(getNextReconnectDelayMs(0)).toBe(5000);
    expect(getNextReconnectDelayMs(4)).toBe(60000);
  });

  it('shouldFetchOnSync respects unchanged and etag', () => {
    expect(shouldFetchOnSync({ type: 'sync', unchanged: true }, 'rev-1')).toBe(false);
    expect(shouldFetchOnSync({ type: 'sync', etag: 'rev-2' }, 'rev-1')).toBe(true);
    expect(shouldFetchOnSync({ type: 'sync' }, null)).toBe(true);
  });

  it('shouldFetchOnFlagsUpdated handles update types', () => {
    expect(shouldFetchOnFlagsUpdated({ type: 'flags-updated', etag: 'a' }, 'b')).toBe(true);
    expect(shouldFetchOnFlagsUpdated({ type: 'update', etag: 'same' }, 'same')).toBe(false);
  });

  it('shouldFetchOnSigningKeyUpdated detects signing key updates', () => {
    expect(shouldFetchOnSigningKeyUpdated({ type: 'signing-key-updated' })).toBe(true);
    expect(shouldFetchOnSigningKeyUpdated({ type: 'sync' })).toBe(false);
  });

  it('extractDefinitionsRevision reads revision headers', () => {
    const response = {
      headers: {
        get: (name: string) => (name === 'X-Definitions-Revision' ? 'rev-123' : null),
      },
    } as Response;

    expect(extractDefinitionsRevision(response)).toBe('rev-123');
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
