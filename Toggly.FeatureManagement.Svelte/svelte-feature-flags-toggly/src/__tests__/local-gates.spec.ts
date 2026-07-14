import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Toggly } from '../services/toggly.service';

const mockFetch = vi.fn();
(globalThis as { fetch?: typeof fetch }).fetch = mockFetch;

describe('Local gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should AND remote true with local gate when gate is off', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ApiV2Checkout: true, Other: true }),
      text: () => Promise.resolve(JSON.stringify({ ApiV2Checkout: true, Other: true })),
    });

    let gateEnabled = false;
    const service = new Toggly({
      appKey: 'test-key',
      environment: 'Production',
      enableLiveUpdates: false,
      localGates: [{
        id: 'apiRedesign',
        flagKeys: ['ApiV2Checkout'],
        isEnabled: () => gateEnabled,
      }],
    });

    await service._loadFeatures();

    expect(await service.isFeatureOn('ApiV2Checkout')).toBe(false);
    expect(await service.isFeatureOn('Other')).toBe(true);
  });

  it('notifyLocalGatesChanged should notify subscribers without fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ApiV2Checkout: true }),
      text: () => Promise.resolve(JSON.stringify({ ApiV2Checkout: true })),
    });

    let gateEnabled = true;
    const listener = vi.fn();
    const service = new Toggly({
      appKey: 'test-key',
      environment: 'Production',
      enableLiveUpdates: false,
      localGates: [{
        id: 'apiRedesign',
        flagKeys: ['ApiV2Checkout'],
        isEnabled: () => gateEnabled,
      }],
    });

    await service._loadFeatures();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const unsub = service.subscribeLocalGatesChanged(listener);
    gateEnabled = false;
    service.notifyLocalGatesChanged();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(await service.isFeatureOn('ApiV2Checkout')).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    unsub();
    service.notifyLocalGatesChanged();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
