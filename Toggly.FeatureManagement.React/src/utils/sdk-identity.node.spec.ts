/**
 * @jest-environment node
 */
import { buildDefinitionFetchHeaders } from './sdk-identity';

describe('sdk-identity (node)', () => {
  it('uses User-Agent when custom headers are unavailable', () => {
    const headers = buildDefinitionFetchHeaders();
    expect(headers['User-Agent']).toBe('toggly-react/1.6.0');
    expect(headers['X-Toggly-Sdk']).toBeUndefined();
  });
});
