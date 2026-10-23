import { describe, it, expect } from 'vitest';
import { buildDefinitionFetchHeaders, SDK_HEADER_ID } from './sdk-identity';

describe('sdk-identity', () => {
  it('preserves Accept and adds SDK attribution headers', () => {
    const headers = buildDefinitionFetchHeaders({ Accept: 'application/json' });
    expect(headers.Accept).toBe('application/json');
    expect(headers[SDK_HEADER_ID] ?? headers['User-Agent']).toMatch(/client-core/);
  });
});
