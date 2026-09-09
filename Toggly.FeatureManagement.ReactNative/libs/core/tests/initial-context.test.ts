import { TogglyService } from '../src/services/TogglyService';
import { MemoryStorage } from '../src/services/MemoryStorage';
import type { AppStateType, NetworkState } from '../src/models';

describe('startup evaluation context', () => {
  let service: TogglyService;
  beforeEach(() => {
    (fetch as jest.Mock).mockReset().mockResolvedValue({ ok: true, status: 200,
      headers: new Map([['ETag', 'revision-1']]), json: async () => ({ enabled: true }) });
  });
  afterEach(() => service?.dispose());

  it('ignores synchronous subscription refreshes until initialization', async () => {
    service = new TogglyService({ appKey: 'app', identity: 'user&123',
      groups: ['beta', 'team a'], claims: { plan: 'pro' }, refreshInterval: 0,
      networkInfo: { getState: async () => ({ isConnected: true }), subscribe: listener => {
        listener({ isConnected: false }); listener({ isConnected: true }); return () => {};
      } }, appState: { getCurrentState: () => 'background', subscribe: listener => {
        listener('active'); return () => {};
      } } });
    expect(fetch).not.toHaveBeenCalled();
    await service.init();
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL((fetch as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get('u')).toBe('user&123');
    expect(url.searchParams.getAll('g')).toEqual(['beta', 'team a']);
    expect(url.searchParams.get('claim.plan')).toBe('pro');
  });

  it('coalesces init and refresh during storage, retaining the constructor snapshot', async () => {
    let release!: (value: string) => void;
    const storage = new MemoryStorage();
    const original = storage.get.bind(storage);
    jest.spyOn(storage, 'get').mockImplementation(key => key === '@toggly:deviceId'
      ? new Promise(resolve => { release = resolve; }) : original(key));
    let app!: (state: AppStateType) => void;
    let network!: (state: NetworkState) => void;
    const groups = ['beta']; const claims = { plan: 'pro' };
    service = new TogglyService({ appKey: 'app', storage, groups, claims, refreshInterval: 0,
      appState: { getCurrentState: () => 'active', subscribe: listener => { app = listener; return () => {}; } },
      networkInfo: { getState: async () => ({ isConnected: true }), subscribe: listener => { network = listener; return () => {}; } } });
    const init = service.init();
    const refresh = service.refresh();
    const duplicate = service.init();
    groups.push('mutated'); claims.plan = 'changed';
    app('background'); app('active'); network({ isConnected: false }); network({ isConnected: true });
    expect(fetch).not.toHaveBeenCalled();
    release('stored-user');
    await Promise.all([init, refresh, duplicate]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL((fetch as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get('u')).toBe('stored-user');
    expect(url.searchParams.getAll('g')).toEqual(['beta']);
    expect(url.searchParams.get('claim.plan')).toBe('pro');
    app('background'); app('active');
    await service.refresh();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a revision or cached flags for delimiter-colliding contexts', async () => {
    const storage = new MemoryStorage();
    service = new TogglyService({ appKey: 'app', identity: 'user', groups: ['a,b'], storage, refreshInterval: 0 });
    await service.init(); service.dispose();
    (fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    service = new TogglyService({ appKey: 'app', identity: 'user', groups: ['a', 'b'], storage, refreshInterval: 0 });
    const response = await service.init();
    expect((fetch as jest.Mock).mock.calls[1][1].headers['If-None-Match']).toBeUndefined();
    expect(response.flags).toEqual({});
  });
  it('reuses a matching cached revision and rejects a legacy unscoped validator', async () => {
    const storage = new MemoryStorage();
    const config = { appKey: 'app', identity: 'user', groups: ['beta'], claims: { plan: 'pro' }, storage, refreshInterval: 0 };
    service = new TogglyService(config);
    await service.init(); service.dispose();
    service = new TogglyService(config);
    await service.init();
    expect((fetch as jest.Mock).mock.calls[1][1].headers['If-None-Match']).toBe('revision-1');
    service.dispose();
    await storage.set('@toggly:etag', 'legacy-revision');
    service = new TogglyService(config);
    await service.init();
    expect((fetch as jest.Mock).mock.calls[2][1].headers['If-None-Match']).toBeUndefined();
  });

  it.each([undefined, ''])('preserves device fallback for identity %s with empty collections', async identity => {
    const storage = new MemoryStorage();
    await storage.set('@toggly:deviceId', 'device');
    service = new TogglyService({ appKey: 'app', identity, groups: [], claims: {}, storage, refreshInterval: 0 });
    await service.init();
    const url = new URL((fetch as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get('u')).toBe('device');
    expect(url.searchParams.getAll('g')).toEqual([]);
    expect([...url.searchParams.keys()].filter(key => key.startsWith('claim.'))).toEqual([]);
  });

  it('explicit identity bypasses stored device identity and caps normalized claims', async () => {
    const storage = new MemoryStorage();
    await storage.set('@toggly:deviceId', 'other-user');
    const claims = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`type${index}`, 'value&=']));
    service = new TogglyService({ appKey: 'app', identity: 'user&123', groups: [' team a ', ''], claims, storage, refreshInterval: 0 });
    await service.init();
    const url = new URL((fetch as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get('u')).toBe('user&123');
    expect(url.searchParams.getAll('g')).toEqual(['team a']);
    expect([...url.searchParams.keys()].filter(key => key.startsWith('claim.'))).toHaveLength(20);
    expect(url.searchParams.get('claim.type0')).toBe('value&=');
  });

  it('allows retry after storage initialization rejects', async () => {
    const storage = new MemoryStorage();
    jest.spyOn(storage, 'get').mockRejectedValueOnce(new Error('storage failed'));
    service = new TogglyService({ appKey: 'app', storage, refreshInterval: 0 });
    await expect(service.init()).rejects.toThrow('storage failed');
    expect(fetch).not.toHaveBeenCalled();
    await service.init();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not start network work or timers when disposed during storage', async () => {
    let release!: (value: string) => void;
    const storage = new MemoryStorage();
    jest.spyOn(storage, 'get').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    service = new TogglyService({ appKey: 'app', storage, refreshInterval: 1, enableLiveUpdates: true });
    const init = service.init();
    service.dispose(); release('device');
    await init;
    expect(fetch).not.toHaveBeenCalled();
    expect(service.initialized).toBe(false);
    expect(service.getDebugInfo().syncServiceRunning).toBe(false);
  });

});
