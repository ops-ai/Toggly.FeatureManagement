import { TogglyService } from '../src/services/TogglyService';
import { MemoryStorage } from '../src/services/MemoryStorage';

describe('304 definitions revision persistence', () => {
  const services: TogglyService[] = [];
  beforeEach(() => (fetch as jest.Mock).mockReset());
  afterEach(() => services.splice(0).forEach(service => service.dispose()));

  function create(storage: MemoryStorage, groups = ['beta']): TogglyService {
    const service = new TogglyService({ appKey: 'app', identity: 'user', groups,
      claims: { plan: 'pro' }, storage, refreshInterval: 0, enableLiveUpdates: false });
    services.push(service);
    return service;
  }

  it.each(['revision-2', undefined])('restores the matching validator after 304 with ETag %s', async updated => {
    const storage = new MemoryStorage();
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200,
      headers: new Map([['ETag', '"revision-1"']]), json: async () => ({ enabled: true }) });
    const first = create(storage);
    await first.init();
    const originalRecord = JSON.parse((await storage.get('@toggly:etag'))!);
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 304,
      headers: new Map(updated ? [['ETag', `"${updated}"`]] : []) });
    expect((await first.refresh()).flags).toEqual({ enabled: true });
    expect(JSON.parse((await storage.get('@toggly:etag'))!)).toEqual({
      context: originalRecord.context, revision: updated ?? 'revision-1',
    });
    first.dispose();

    (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 304, headers: new Map() });
    const restored = create(storage);
    expect((await restored.init()).flags).toEqual({ enabled: true });
    expect((fetch as jest.Mock).mock.calls[2][1].headers['If-None-Match']).toBe(updated ?? 'revision-1');
    restored.dispose();

    (fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    const foreign = create(storage, ['other']);
    expect((await foreign.init()).flags).toEqual({});
    expect((fetch as jest.Mock).mock.calls[3][1].headers['If-None-Match']).toBeUndefined();
  });

  it('does not store an unsolicited 304 revision without a matching validator', async () => {
    const storage = new MemoryStorage();
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 304,
      headers: new Map([['ETag', '"unowned"']]) });
    await create(storage).init();
    expect(await storage.get('@toggly:etag')).toBeNull();
  });

  it('does not replace the validator when a 200 payload is invalid', async () => {
    const storage = new MemoryStorage();
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200,
      headers: new Map([['ETag', '"revision-1"']]), json: async () => ({ enabled: true }) });
    const service = create(storage);
    await service.init();
    const previous = await storage.get('@toggly:etag');
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200,
      headers: new Map([['ETag', '"invalid-payload-revision"']]), text: async () => '{' });
    expect((await service.refresh()).flags).toEqual({ enabled: true });
    expect(await storage.get('@toggly:etag')).toBe(previous);
  });
});
