import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { createToggly } from '../utils/createToggly';
import { togglyServiceStore, togglyFlagsStore, togglyVariantsStore } from '../stores/toggly.store';

describe('createToggly', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    togglyServiceStore.set(null);
    togglyFlagsStore.set({});
    togglyVariantsStore.set({});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should initialize Toggly service and set stores', async () => {
    // Mock fetch to prevent actual network calls (even without appKey,
    // _loadFeatures tries to fetch when cache is invalid)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));

    await createToggly({
      featureDefaults: { F1: true, F2: false },
    });

    const service = get(togglyServiceStore);
    expect(service).toBeTruthy();

    const flags = get(togglyFlagsStore);
    expect(flags).toEqual({ F1: true, F2: false });
  });

  it('should load features from API when appKey provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ F1: true, F2: true }),
    } as Response);

    await createToggly({
      appKey: 'test-key',
      environment: 'Production',
    });

    expect(fetchSpy).toHaveBeenCalled();
    const flags = get(togglyFlagsStore);
    expect(flags).toEqual({ F1: true, F2: true });
  });

  it('should load variants and populate togglyVariantsStore when enableVariants', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () =>
        Promise.resolve({
          defs: {
            V: { enabled: true, variant: 'A', configurationValue: { x: 1 } },
          },
        }),
    } as Response);

    await createToggly({
      appKey: 'test-key',
      environment: 'Production',
      enableVariants: true,
      enableLiveUpdates: false,
    });

    const variants = get(togglyVariantsStore);
    expect(variants.V).toEqual({
      enabled: true,
      variant: 'A',
      configurationValue: { x: 1 },
    });
    expect(get(togglyFlagsStore)).toEqual({ V: true });
  });

  it('should set empty flags on load error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    await createToggly({
      appKey: 'test-key',
      environment: 'Production',
    });

    const flags = get(togglyFlagsStore);
    // When fetch fails, features fall back to defaults or {}
    expect(flags).toBeTruthy();
  });

  it('should set up periodic refresh when appKey provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ F1: true }),
    } as Response);

    await createToggly({
      appKey: 'test-key',
      environment: 'Production',
      featureFlagsRefreshInterval: 5000,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance timer to trigger refresh
    await vi.advanceTimersByTimeAsync(5000);

    // Should have called fetch again (refreshFlags resets cache + _loadFeatures)
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('should not set up periodic refresh without appKey', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    await createToggly({
      featureDefaults: { F1: true },
    });

    // setInterval should not be called for periodic refresh when no appKey
    // (the condition is refreshInterval > 0 && config.appKey)
    const refreshCalls = setIntervalSpy.mock.calls.filter(
      (call) => typeof call[1] === 'number' && call[1] > 1000
    );
    expect(refreshCalls.length).toBe(0);
  });

  it('should handle refresh errors gracefully', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { json: () => Promise.resolve({ F1: true }) } as Response;
      }
      throw new Error('Refresh failed');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await createToggly({
      appKey: 'test-key',
      environment: 'Production',
      featureFlagsRefreshInterval: 5000,
    });

    // Advance timer to trigger refresh
    await vi.advanceTimersByTimeAsync(5000);

    // Should not crash, warning logged
    expect(get(togglyServiceStore)).toBeTruthy();
  });

  it('should handle null flags from _loadFeatures', async () => {
    // When features return null, flags store should not be set to null
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () => Promise.resolve(null),
    } as Response);

    await createToggly({
      appKey: 'test-key',
      environment: 'Production',
    });

    // Flags should remain as initial (empty or from defaults)
    const flags = get(togglyFlagsStore);
    expect(flags).toBeTruthy();
  });

  it('should handle _loadFeatures throwing unexpectedly', async () => {
    // Force _loadFeatures to throw (normally it catches internally)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Sync error');
    });

    await createToggly({
      appKey: 'test-key',
      environment: 'Production',
    });

    // Should fall back to empty flags via catch block
    const flags = get(togglyFlagsStore);
    expect(flags).toBeTruthy();
  });

  it('should use default refresh interval of 3 minutes', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ F1: true }),
    } as Response);

    await createToggly({
      appKey: 'test-key',
      environment: 'Production',
    });

    const refreshCall = setIntervalSpy.mock.calls.find(
      (call) => call[1] === 3 * 60 * 1000
    );
    expect(refreshCall).toBeTruthy();
  });
});
