import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchBuildTimeFlags } from './fetch-build-flags';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('fetchBuildTimeFlags', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses unsigned JSON defs when verifySignatures is false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ defs: { FeatureA: true } }),
      json: async () => ({ defs: { FeatureA: true } }),
    });

    const flags = await fetchBuildTimeFlags({
      appKey: 'test-key',
      flagDefaults: { FeatureA: false },
    });

    expect(flags).toEqual({ FeatureA: true });
  });

  it('reads text() and falls back on invalid envelope when verifySignatures is true', async () => {
    const invalidBody = JSON.stringify({ defs: { FeatureA: true } });
    const text = vi.fn().mockResolvedValue(invalidBody);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text,
      json: async () => JSON.parse(invalidBody),
    });

    const flags = await fetchBuildTimeFlags({
      appKey: 'test-key',
      verifySignatures: true,
      flagDefaults: { FeatureA: false },
    });

    expect(text).toHaveBeenCalled();
    expect(flags).toEqual({ FeatureA: false });
  });
});
