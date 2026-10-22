import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTogglyClient } from './toggly-client';
import * as signedResponse from './signed-response.js';

describe('createTogglyClient live fetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flattens evaluated object defs to booleans', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ defs: { gated: true, plain: false } }),
    });
    const client = createTogglyClient({
      appKey: 'app',
      enableTelemetry: false,
      fetch,
    });
    try {
      expect(await client.getFlags()).toEqual({ gated: true, plain: false });
      expect(await client.getFlag('gated')).toBe(true);
    } finally {
      client.dispose();
    }
  });

  it('warns and records error when fetch fails and no cache exists', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
    const client = createTogglyClient({
      appKey: 'app',
      enableTelemetry: false,
      flagDefaults: { a: false },
      fetch,
    });
    try {
      const flags = await client.getFlags();
      expect(flags).toEqual({ a: false });
      expect(client.getLastLiveFetchError()).toBeInstanceOf(Error);
      expect(warn).toHaveBeenCalled();
    } finally {
      client.dispose();
    }
  });

  it('passes the configured fetch as fetchImpl (no definitions abort signal wrapper)', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ On: true }),
    });
    const parseSpy = vi
      .spyOn(signedResponse, 'parseEvaluatedResponseBody')
      .mockImplementation(async (body, options) => {
        expect(options.fetchImpl).toBe(fetch);
        return signedResponse.unwrapDefsPayload(JSON.parse(body));
      });
    const client = createTogglyClient({
      appKey: 'app',
      enableTelemetry: false,
      fetch,
    });
    try {
      expect(await client.getFlags()).toEqual({ On: true });
    } finally {
      parseSpy.mockRestore();
      client.dispose();
    }
  });
});
