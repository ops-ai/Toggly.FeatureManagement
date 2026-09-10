import { describe, it, expect, vi } from 'vitest';
import { createTogglyClient } from './toggly-client';

describe('initial evaluation context', () => {
  it('snapshots context before the first request and reuses only its own cache', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: true }) });
    const groups = [' beta ', 'team a&b', ''];
    const claims = { plan: 'pro&plus=1' };
    const config = { appKey: 'app', identity: 'user&123#x', groups, claims, fetch };
    const client = createTogglyClient(config);
    groups.push('late'); claims.plan = 'late'; config.identity = 'late';
    await client.getFlags();
    await client.getFlags();
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get('u')).toBe('user&123#x');
    expect(url.searchParams.getAll('g')).toEqual(['beta', 'team a&b']);
    expect(url.searchParams.get('claim.plan')).toBe('pro&plus=1');
    const other = createTogglyClient({ appKey: 'app', identity: 'user&123#x', groups: ['beta,team a&b'], claims: { plan: 'other' }, fetch });
    await other.getFlags();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(fetch.mock.calls[1][0]).searchParams.getAll('g')).toEqual(['beta,team a&b']);
  });

  it.each([{}, { identity: '', groups: [], claims: {} }])('preserves anonymous startup with %j', async (context) => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    await createTogglyClient({ appKey: 'app', fetch, ...context }).getFlags();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).search).toBe('');
  });

  it('defers malformed URL errors until a request is made', async () => {
    const fetch = vi.fn();
    let client!: ReturnType<typeof createTogglyClient>;
    expect(() => { client = createTogglyClient({ appKey: 'app', baseURI: 'invalid', fetch }); }).not.toThrow();
    await expect(client.getFlags()).rejects.toThrow();
    await expect(client.refreshFlags()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('caps claims deterministically and keeps startup context on refresh', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const claims = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`type${String(i).padStart(2, '0')}`, 'value']));
    const client = createTogglyClient({ appKey: 'app', claims, fetch });
    await client.getFlags();
    claims.type00 = 'changed';
    await client.refreshFlags();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
    const params = new URL(fetch.mock.calls[0][0]).searchParams;
    expect([...params.keys()].filter(key => key.startsWith('claim.'))).toHaveLength(20);
    expect(params.get('claim.type00')).toBe('value');
    expect(params.has('claim.type24')).toBe(false);
  });
});
