import { Toggly } from '../lib/toggly';
import { StorageKeys, TogglyConfig } from '../lib/models';

jest.mock('uuid', () => ({ v4: () => 'generated-user' }));
const fetchMock = jest.fn();
const defaults = { appKey: 'initial-context', featureFlagsRefreshInterval: 0, enableLiveUpdates: false };
const context: { identity: string; groups: string[]; claims: Record<string, string> } = { identity: 'user&123?#', groups: ['beta', 'team a&b'], claims: { plan: 'pro&plus', 'role?#': 'reader/admin' } };

function assertContext(url: string, expected = context, variants = false) {
  const query = new URL(url).searchParams;
  expect(query.get(variants ? 'userId' : 'u')).toBe(expected.identity || null);
  expect(query.getAll('g')).toEqual(expected.groups);
  for (const [name, value] of Object.entries(expected.claims)) expect(query.get(`claim.${name}`)).toBe(value);
}

beforeEach(() => {
  localStorage.clear();
  Toggly.cancelRefreshInterval();
  Toggly.removeHook('delayed');
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ Feature: true }) });
  (global as any).fetch = fetchMock;
});
afterEach(() => { Toggly.cancelRefreshInterval(); jest.restoreAllMocks(); });

describe('initial evaluation context', () => {
  it.each([false, true])('sends all context on exactly one first request (variants=%s)', async enableVariants => {
    await Toggly.init({ ...defaults, ...context, enableVariants });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    assertContext(fetchMock.mock.calls[0][0], context, enableVariants);
  });

  it('overrides persisted context, and preserves omitted fields', async () => {
    localStorage.setItem(StorageKeys.identityKey, 'stored-user');
    localStorage.setItem(StorageKeys.groupsKey, '["stored-group"]');
    localStorage.setItem(StorageKeys.claimsKey, '{"plan":"stored"}');
    await Toggly.init({ ...defaults, identity: context.identity } as TogglyConfig);
    assertContext(fetchMock.mock.calls[0][0], { ...context, groups: ['stored-group'], claims: { plan: 'stored' } });
    await Toggly.init({ ...defaults, ...context });
    assertContext(fetchMock.mock.calls[1][0]);
  });

  it('clears explicitly empty fields without generating an identity', async () => {
    Toggly.identity = 'stored-user'; Toggly.groups = ['old']; Toggly.claims = { old: 'value' };
    await Toggly.init({ ...defaults, identity: '', groups: [], claims: {} } as TogglyConfig);
    expect(Toggly.identity).toBe('');
    expect(Toggly.groups).toEqual([]);
    expect(Toggly.claims).toEqual({});
    expect(Array.from(new URL(fetchMock.mock.calls[0][0]).searchParams)).toEqual([]);
  });

  it('uses a generated identity only when omitted and no identity is stored', async () => {
    await Toggly.init(defaults);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('u')).toBe('generated-user');
  });

  it('snapshots collections before callers can mutate them', async () => {
    const groups = [...context.groups]; const claims = { ...context.claims };
    const pending = Toggly.init({ ...defaults, identity: context.identity, groups, claims } as TogglyConfig);
    groups.push('later'); claims.plan = 'changed';
    await pending; await Toggly.refresh();
    fetchMock.mock.calls.forEach(([url]) => assertContext(url));
  });

  it('does not wait for identify hooks before sending seeded context', async () => {
    let release!: () => void;
    const pendingHook = new Promise<void>(resolve => { release = resolve; });
    const beforeIdentify = jest.fn(async () => { await pendingHook; });
    await Toggly.init({ ...defaults, ...context, hooks: [{ getMetadata: () => ({ name: 'delayed' }), beforeIdentify }] });
    expect(beforeIdentify).toHaveBeenCalledWith(context.identity);
    assertContext(fetchMock.mock.calls[0][0]);
    release();
  });

  it('uses only matching full-context cached flags on a failed initial request', async () => {
    await Toggly.init({ ...defaults, ...context, groups: ['other'] });
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await Toggly.init({ ...defaults, ...context })).toEqual({});
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ Matching: true }) });
    await Toggly.init({ ...defaults, ...context });
    expect(await Toggly.init({ ...defaults, ...context })).toEqual({ Matching: true });
  });

  it('reuses flags and revision for reordered group memberships', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ ETag: 'group-revision' }), json: async () => ({ Matching: true }) });
    await Toggly.init({ ...defaults, ...context, groups: ['beta', 'Alpha', 'équipe'] });
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await Toggly.init({ ...defaults, ...context, groups: ['équipe', 'Alpha', 'beta'] })).toEqual({ Matching: true });
    expect(fetchMock.mock.calls[1][1].headers['If-None-Match']).toBe('group-revision');
  });

  it('does not reuse another context revision on initialization', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ ETag: 'old-revision' }), json: async () => ({ Old: true }) });
    await Toggly.init({ ...defaults, ...context, groups: ['old'] });
    await Toggly.init({ ...defaults, ...context });
    expect(fetchMock.mock.calls[1][1].headers['If-None-Match']).toBeUndefined();
    await Toggly.init({ ...defaults, ...context });
    expect(fetchMock.mock.calls[2][1].headers['If-None-Match']).toBe('old-revision');
  });

  it.each([
    [{ groups: ['a,b'] }, { groups: ['a', 'b'] }],
    [{ claims: { a: 'b&c=d' } }, { claims: { a: 'b', c: 'd' } }],
    [{ identity: 'u|g:admins', groups: [] }, { identity: 'u', groups: ['admins'] }],
  ])('isolates delimiter-containing contexts in cache and revision', async (first, second) => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ ETag: 'revision-a' }), json: async () => ({ Wrong: true }) });
    await Toggly.init({ ...defaults, identity: 'u', groups: [], claims: {}, ...first });
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await Toggly.init({ ...defaults, identity: 'u', groups: [], claims: {}, ...second })).toEqual({});
    expect(fetchMock.mock.calls[1][1].headers['If-None-Match']).toBeUndefined();
  });

  it('does not send a persisted revision after its flags cache is removed', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ ETag: 'revision' }), json: async () => ({ Feature: true }) });
    await Toggly.init({ ...defaults, ...context });
    Toggly.clearFeatureFlagsCache();
    await Toggly.init({ ...defaults, ...context });
    expect(fetchMock.mock.calls[1][1].headers['If-None-Match']).toBeUndefined();
  });

  it('fetches variants unconditionally when only boolean flags were cached', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ ETag: 'boolean-revision' }), json: async () => ({ Feature: true }) });
    await Toggly.init({ ...defaults, ...context });
    await Toggly.init({ ...defaults, ...context, enableVariants: true });
    expect(fetchMock.mock.calls[1][1].headers['If-None-Match']).toBeUndefined();
  });

  it.each(['missing', 'throws'])('works when localStorage is %s at module import', async mode => {
    jest.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      if (mode === 'throws') throw new Error('denied');
      return undefined as unknown as Storage;
    });
    let sdk!: typeof Toggly;
    jest.isolateModules(() => { sdk = require('../lib/toggly').Toggly; });
    await sdk.init({ ...defaults, ...context });
    assertContext(fetchMock.mock.calls[0][0]);
    await sdk.clearContext();
    expect(sdk.identity).toBe(''); expect(sdk.groups).toEqual([]); expect(sdk.claims).toEqual({});
    sdk.clearIdentity();
    sdk.cancelRefreshInterval();
  });

  it('does not resurrect stored context when only writes fail', async () => {
    Toggly.identity = 'old'; Toggly.groups = ['old']; Toggly.claims = { old: 'old' };
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await Toggly.init({ ...defaults, ...context });
    assertContext(fetchMock.mock.calls[0][0]);
  });

  it('keeps context in memory when storage reads and writes throw', async () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    await Toggly.init({ ...defaults, ...context });
    assertContext(fetchMock.mock.calls[0][0]);
    const groups = Toggly.groups; groups.push('external');
    const claims = Toggly.claims; claims.plan = 'external';
    await Toggly.refresh(); assertContext(fetchMock.mock.calls[1][0]);
    await Toggly.clearContext();
    expect(Toggly.identity).toBe(''); expect(Toggly.groups).toEqual([]); expect(Toggly.claims).toEqual({});
  });
});
