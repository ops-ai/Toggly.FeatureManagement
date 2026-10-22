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

  it('keeps lastLiveFetchError when a later fetch fails with cached fallback defaults', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' })
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' });
    const client = createTogglyClient({
      appKey: 'app',
      enableTelemetry: false,
      flagDefaults: { a: false },
      featureFlagsRefreshInterval: 0,
      fetch,
    });
    try {
      expect(await client.getFlags()).toEqual({ a: false });
      expect(client.getLastLiveFetchError()).toBeInstanceOf(Error);
      expect(await client.getFlags()).toEqual({ a: false });
      expect(client.getLastLiveFetchError()).toBeInstanceOf(Error);
      expect(fetch).toHaveBeenCalledTimes(2);
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

  it('passes a connectTimeout-bounded fetchImpl for JWKS (not the definitions abort signal)', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('evaluated-signed')) {
        return Promise.resolve({
          ok: true,
          text: async () => JSON.stringify({ On: true }),
        });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      });
    });
    const parseSpy = vi
      .spyOn(signedResponse, 'parseEvaluatedResponseBody')
      .mockImplementation(async (_body, options) => {
        expect(options.fetchImpl).not.toBe(fetch);
        const pending = options.fetchImpl!('https://definitions.test/.well-known/jwks', {
          method: 'GET',
        });
        vi.advanceTimersByTime(5000);
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        return { On: true };
      });
    const client = createTogglyClient({
      appKey: 'app',
      enableTelemetry: false,
      connectTimeout: 5000,
      verifySignatures: true,
      fetch,
    });
    try {
      expect(await client.getFlags()).toEqual({ On: true });
    } finally {
      parseSpy.mockRestore();
      client.dispose();
      vi.useRealTimers();
    }
  });

  it('aborts in-flight JWKS fetch on dispose', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('evaluated-signed')) {
        return Promise.resolve({
          ok: true,
          text: async () => JSON.stringify({ On: true }),
        });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      });
    });
    vi.spyOn(signedResponse, 'parseEvaluatedResponseBody').mockImplementation(async (_body, options) => {
      const pending = options.fetchImpl!('https://definitions.test/.well-known/jwks', { method: 'GET' });
      return pending.then(() => ({ On: true }));
    });
    const client = createTogglyClient({
      appKey: 'app',
      enableTelemetry: false,
      connectTimeout: 60_000,
      verifySignatures: true,
      fetch,
    });
    const flagsPromise = client.getFlags();
    await Promise.resolve();
    client.dispose();
    await expect(flagsPromise).resolves.toEqual({});
    vi.useRealTimers();
  });
});
