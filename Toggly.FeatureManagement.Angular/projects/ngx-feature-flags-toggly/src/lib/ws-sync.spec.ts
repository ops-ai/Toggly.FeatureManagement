import {
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  shouldFetchOnSync,
  DEFINITIONS_REVISION_HEADER,
} from './ws-sync';

describe('ws-sync', () => {
  it('buildWebSocketUrl appends rev and sdk query params', () => {
    expect(buildWebSocketUrl('https://definitions.toggly.io', 'app-key', 'abc123'))
      .toBe('wss://definitions.toggly.io/app-key/ws?rev=abc123&sdk=angular&sdkVersion=2.2.1');
  });

  it('getNextReconnectDelayMs caps at max delay', () => {
    expect(getNextReconnectDelayMs(10)).toBe(60000);
  });

  it('shouldFetchOnSync skips fetch when unchanged', () => {
    expect(shouldFetchOnSync({ type: 'sync', etag: 'abc', unchanged: true }, 'abc')).toBeFalse();
  });

  it('shouldFetchOnFlagsUpdated skips when etag matches', () => {
    expect(shouldFetchOnFlagsUpdated({ type: 'flags-updated', etag: 'same' }, 'same')).toBeFalse();
  });

  it('shouldFetchOnFlagsUpdated fetches when etag is missing', () => {
    expect(shouldFetchOnFlagsUpdated({ type: 'update' }, 'cached')).toBeTrue();
  });

  it('buildWebSocketUrl works without cached revision', () => {
    expect(buildWebSocketUrl('https://definitions.toggly.io', 'app-key', null))
      .toBe('wss://definitions.toggly.io/app-key/ws?sdk=angular&sdkVersion=2.2.1');
  });

  it('shouldFetchOnSigningKeyUpdated detects rotation', () => {
    expect(shouldFetchOnSigningKeyUpdated({ type: 'signing-key-updated' })).toBeTrue();
  });

  it('extractDefinitionsRevision reads revision header', () => {
    const response = {
      headers: {
        get: (key: string) => (key === DEFINITIONS_REVISION_HEADER ? 'rev-abc' : null),
      },
    } as Response;
    expect(extractDefinitionsRevision(response)).toBe('rev-abc');
  });
});
