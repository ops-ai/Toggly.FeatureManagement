import { SDK_ID, SDK_VERSION } from './sdk-identity';
import {
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  appendDefinitionsRevisionParam,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  shouldFetchOnSync,
  DEFINITIONS_REVISION_HEADER,
} from './ws-sync';

describe('ws-sync', () => {
  it('buildWebSocketUrl appends rev and sdk query params', () => {
    expect(buildWebSocketUrl('https://definitions.toggly.io', 'app-key', 'abc123')).toBe(
      `wss://definitions.toggly.io/app-key/ws?rev=abc123&sdk=${SDK_ID}&sdkVersion=${SDK_VERSION}`
    );
  });

  it('getNextReconnectDelayMs backs off to the max delay', () => {
    expect(getNextReconnectDelayMs(0)).toBe(5000);
    expect(getNextReconnectDelayMs(10)).toBe(60000);
  });

  it('shouldFetchOnSync respects unchanged and etag', () => {
    expect(shouldFetchOnSync({ type: 'sync', etag: 'abc', unchanged: true }, 'abc')).toBe(false);
    expect(shouldFetchOnSync({ type: 'sync', etag: 'new' }, 'old')).toBe(true);
  });

  it('shouldFetchOnSync returns false for non-sync message types', () => {
    expect(shouldFetchOnSync({ type: 'update', etag: 'new' }, 'old')).toBe(false);
  });

  it('shouldFetchOnSync returns true when no cached etag exists', () => {
    expect(shouldFetchOnSync({ type: 'sync', etag: 'new' }, null)).toBe(true);
  });

  it('shouldFetchOnFlagsUpdated supports update types', () => {
    expect(shouldFetchOnFlagsUpdated({ type: 'update', etag: 'new' }, 'old')).toBe(true);
  });

  it('shouldFetchOnSigningKeyUpdated detects signing key updates', () => {
    expect(shouldFetchOnSigningKeyUpdated({ type: 'signing-key-updated' })).toBe(true);
  });

  it('extractDefinitionsRevision reads revision headers', () => {
    const response = {
      headers: {
        get: (key: string) => (key === DEFINITIONS_REVISION_HEADER ? 'rev-abc' : null),
      },
    } as Response;
    expect(extractDefinitionsRevision(response)).toBe('rev-abc');
  });

  it('shouldFetchOnSync returns false when etag matches cached revision', () => {
    expect(shouldFetchOnSync({ type: 'sync', etag: 'same' }, 'same')).toBe(false);
  });

  it('shouldFetchOnFlagsUpdated returns false when etag matches cached revision', () => {
    expect(shouldFetchOnFlagsUpdated({ type: 'update', etag: 'same' }, 'same')).toBe(false);
  });

  it('shouldFetchOnFlagsUpdated returns true when etag is missing', () => {
    expect(shouldFetchOnFlagsUpdated({ type: 'flags-updated' }, 'cached')).toBe(true);
  });

  it('shouldFetchOnFlagsUpdated returns false for non-update message types', () => {
    expect(shouldFetchOnFlagsUpdated({ type: 'sync', etag: 'new' }, 'old')).toBe(false);
  });

  it('buildWebSocketUrl works without cached revision', () => {
    expect(buildWebSocketUrl('https://definitions.toggly.io', 'app-key', null)).toBe(
      `wss://definitions.toggly.io/app-key/ws?sdk=${SDK_ID}&sdkVersion=${SDK_VERSION}`
    );
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

