import { SDK_ID, SDK_VERSION } from './sdk-identity';
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
});
