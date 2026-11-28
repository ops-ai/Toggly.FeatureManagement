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
    const isColor = (v: unknown): v is { color: string } =>
      typeof v === 'object' && v !== null && typeof (v as { color?: unknown }).color === 'string';
    expect(service.getVariantValue('onFeature', isColor)).toEqual({ color: 'blue' });
    expect(service.getVariantValue('onFeature', (v): v is number => typeof v === 'number')).toBeNull();
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

  describe('typed flag value getters', () => {
    async function initTyped(storage = new MemoryStorage()) {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({
          stringFlag: { enabled: true, variant: 'default', valueType: 'string', configurationValue: 'hello' },
          numberFlag: { enabled: true, variant: 'default', valueType: 'number', configurationValue: 42 },
          jsonFlag: { enabled: true, variant: 'default', valueType: 'json', configurationValue: { color: 'blue' } },
          dateFlag: { enabled: true, variant: 'default', valueType: 'datetime', configurationValue: '2026-01-15T10:00:00Z' },
          mismatch: { enabled: true, variant: 'default', valueType: 'number', configurationValue: 'not-a-number-type' },
          disabledFlag: { enabled: false, variant: 'default', valueType: 'string', configurationValue: 'hidden' },
          legacyFlag: { enabled: true, variant: 'default', configurationValue: 'no-declared-type' },
        }),
      });
      const service = create(storage);
      await service.init();
      return service;
    }

    it('getStringValue returns the typed string and soft-nulls a mismatched type', async () => {
      const service = await initTyped();
      expect(service.getStringValue('stringFlag')).toBe('hello');
      expect(service.getStringValue('numberFlag')).toBeNull();
    });

    it('getNumberValue returns the typed number and soft-nulls when the declared type disagrees', async () => {
      const service = await initTyped();
      expect(service.getNumberValue('numberFlag')).toBe(42);
      expect(service.getNumberValue('mismatch')).toBeNull();
    });

    it('getJsonValue returns the raw payload and honors an isT guard', async () => {
      const service = await initTyped();
      expect(service.getJsonValue('jsonFlag')).toEqual({ color: 'blue' });
      const isColor = (v: unknown): v is { color: string } =>
        typeof v === 'object' && v !== null && typeof (v as { color?: unknown }).color === 'string';
      expect(service.getJsonValue('jsonFlag', isColor)).toEqual({ color: 'blue' });
      expect(service.getJsonValue('jsonFlag', (v): v is number => typeof v === 'number')).toBeNull();
    });

    it('getDateTimeValue parses an ISO-8601 wire string and soft-nulls a mismatched type', async () => {
      const service = await initTyped();
      expect(service.getDateTimeValue('dateFlag')).toEqual(new Date('2026-01-15T10:00:00Z'));
      expect(service.getDateTimeValue('stringFlag')).toBeNull();
    });

    it('typed getters soft-null when disabled or unknown', async () => {
      const service = await initTyped();
      expect(service.getStringValue('disabledFlag')).toBeNull();
      expect(service.getStringValue('missing')).toBeNull();
      expect(service.getNumberValue('missing')).toBeNull();
      expect(service.getJsonValue('missing')).toBeNull();
      expect(service.getDateTimeValue('missing')).toBeNull();
    });

    it('typed getters attempt a decode when no valueType is declared', async () => {
      const service = await initTyped();
      expect(service.getStringValue('legacyFlag')).toBe('no-declared-type');
    });
  });
});
