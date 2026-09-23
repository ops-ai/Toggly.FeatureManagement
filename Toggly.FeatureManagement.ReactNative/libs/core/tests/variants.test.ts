import { TogglyService } from '../src/services/TogglyService';
import { MemoryStorage } from '../src/services/MemoryStorage';

describe('enableVariants', () => {
  const services: TogglyService[] = [];
  beforeEach(() => (fetch as jest.Mock).mockReset());
  afterEach(() => services.splice(0).forEach(service => service.dispose()));

  function create(storage: MemoryStorage, overrides: Record<string, unknown> = {}): TogglyService {
    const service = new TogglyService({
      enableTelemetry: false,
      appKey: 'app',
      identity: 'user',
      environment: 'Production',
      storage,
      refreshInterval: 0,
      enableLiveUpdates: false,
      enableVariants: true,
      ...overrides,
    });
    services.push(service);
    return service;
  }

  it('requests /evaluated-variants-signed with ?userId= instead of /evaluated-signed with ?u=', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({ feature1: { enabled: true, variant: 'treatment', configurationValue: { color: 'blue' } } }),
    });

    const service = create(new MemoryStorage());
    await service.init();

    const requestedUrl = (fetch as jest.Mock).mock.calls[0][0] as string;
    expect(requestedUrl).toContain('/evaluated-variants-signed/app/Production');
    expect(requestedUrl).toContain('userId=user');
    expect(requestedUrl).not.toContain('/evaluated-signed/');
  });

  it('projects variant defs onto boolean flags for gate evaluation', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        onFeature: { enabled: true, variant: 'treatment', configurationValue: { color: 'blue' } },
        offFeature: { enabled: false, variant: 'control' },
      }),
    });

    const service = create(new MemoryStorage());
    const response = await service.init();

    expect(response.flags).toEqual({ onFeature: true, offFeature: false });
    expect(await service.isFeatureOn('onFeature')).toBe(true);
    expect(await service.isFeatureOn('offFeature')).toBe(false);
  });

  it('getVariant returns name and configurationValue when the feature is enabled', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        onFeature: { enabled: true, variant: 'treatment', configurationValue: { color: 'blue' } },
      }),
    });

    const service = create(new MemoryStorage());
    await service.init();

    expect(service.getVariant('onFeature')).toEqual({ name: 'treatment', configurationValue: { color: 'blue' } });
    expect(service.getVariantValue('onFeature')).toEqual({ color: 'blue' });
  });

  it('getVariant returns null when the feature is disabled, unknown, or variants are off', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        offFeature: { enabled: false, variant: 'control', configurationValue: { color: 'red' } },
      }),
    });

    const withVariants = create(new MemoryStorage());
    await withVariants.init();
    expect(withVariants.getVariant('offFeature')).toBeNull();
    expect(withVariants.getVariant('unknownFeature')).toBeNull();
    expect(withVariants.getVariantValue('offFeature')).toBeNull();

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({ onFeature: true }),
    });
    const withoutVariants = create(new MemoryStorage(), { enableVariants: false });
    await withoutVariants.init();
    expect(withoutVariants.getVariant('onFeature')).toBeNull();
  });

  it('restores cached variant assignment after a conditional 304 refresh', async () => {
    const storage = new MemoryStorage();
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map([['ETag', '"revision-1"']]),
      json: async () => ({ onFeature: { enabled: true, variant: 'treatment', configurationValue: 42 } }),
    });

    const first = create(storage);
    await first.init();
    expect(first.getVariant('onFeature')).toEqual({ name: 'treatment', configurationValue: 42 });

    (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 304, headers: new Map() });
    const refreshed = await first.refresh();
    expect(refreshed.flags).toEqual({ onFeature: true });
    expect(first.getVariant('onFeature')).toEqual({ name: 'treatment', configurationValue: 42 });
    first.dispose();

    // A freshly constructed owner backed by the same storage must rehydrate the variant
    // assignment (not just the boolean projection) from the persisted cache entry.
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 304, headers: new Map() });
    const restored = create(storage);
    const restoredResponse = await restored.init();
    expect(restoredResponse.flags).toEqual({ onFeature: true });
    expect(restored.getVariant('onFeature')).toEqual({ name: 'treatment', configurationValue: 42 });
  });

  it('falls back to cached variant assignment when a later refresh fails', async () => {
    const storage = new MemoryStorage();
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map([['ETag', '"revision-1"']]),
      json: async () => ({ onFeature: { enabled: true, variant: 'treatment', configurationValue: 'v1' } }),
    });

    const service = create(storage);
    await service.init();

    (fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    const response = await service.refresh();
    expect(response.status).toBe('cached');
    expect(response.flags).toEqual({ onFeature: true });
    expect(service.getVariant('onFeature')).toEqual({ name: 'treatment', configurationValue: 'v1' });
  });

  it('clears the cached variant assignment on clearCache and identity change', async () => {
    const storage = new MemoryStorage();
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({ onFeature: { enabled: true, variant: 'treatment' } }),
    });

    const service = create(storage);
    await service.init();
    expect(service.getVariant('onFeature')).toEqual({ name: 'treatment', configurationValue: undefined });

    await service.clearCache();
    expect(service.getVariant('onFeature')).toBeNull();

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({ onFeature: { enabled: true, variant: 'other-user-variant' } }),
    });
    await service.setIdentity('someone-else');
    expect(service.getVariant('onFeature')).toEqual({ name: 'other-user-variant', configurationValue: undefined });
  });
});
