import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TogglyServer, TogglyFetchError } from '../../server/toggly-server.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(body: unknown, status = 200) {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(bodyText),
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
  };
}

function featureDefs(flags: Record<string, boolean>) {
  return Object.entries(flags).map(([featureKey, enabled]) => ({
    featureKey,
    filters: [{ name: enabled ? 'AlwaysOn' : 'AlwaysOff', parameters: {} }],
  }));
}

function createDefsResponse(flags: Record<string, boolean>, status = 200) {
  return createMockResponse(featureDefs(flags), status);
}

/**
 * These expectations fail on 1.21.0 (silent swallow → {} / flagDefaults).
 * They pass once fetchFlags always logs and surfaces errors when there is no
 * last-known-good (fromNetwork) cache.
 */
describe('TogglyServer fetch error surfacing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubEnv('TOGGLY_DISABLE_TELEMETRY', '1');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('logs and throws TogglyFetchError on network error when no cache exists', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const server = new TogglyServer({
      appKey: 'bad-key',
      environment: 'Production',
      isDebug: false,
    });

    await expect(server.refreshFlags()).rejects.toBeInstanceOf(TogglyFetchError);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Toggly Server] Error fetching flags:'),
      expect.anything(),
    );
    errorSpy.mockRestore();
  });

  it('logs and throws on non-200 HTTP status when no cache exists', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce(createMockResponse({}, 404));

    const server = new TogglyServer({
      appKey: '00000000-0000-0000-0000-000000000000',
      environment: 'Production',
      isDebug: false,
    });

    const err = await server.refreshFlags().then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(TogglyFetchError);
    expect((err as TogglyFetchError).status).toBe(404);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('logs and throws on malformed JSON when no cache exists', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('{not-json'),
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });

    const server = new TogglyServer({
      appKey: 'test-key',
      environment: 'Production',
      isDebug: false,
    });

    await expect(server.getFlags()).rejects.toBeInstanceOf(TogglyFetchError);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('falls back to cached definitions and still logs when a last-known-good cache exists', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockFetch
      .mockResolvedValueOnce(createDefsResponse({ Feature1: true }))
      .mockRejectedValueOnce(new Error('Network error'));

    const server = new TogglyServer({
      appKey: 'test-key',
      environment: 'Production',
      featureFlagsRefreshInterval: 1000,
      isDebug: false,
    });

    await server.getFlags();
    vi.advanceTimersByTime(1500);

    const flags = await server.getFlags();
    expect(flags).toEqual({ Feature1: true });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Toggly Server] Error fetching flags:'),
      expect.anything(),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Using cached flags after fetch failure'),
    );

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('keeps success path unchanged', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce(createDefsResponse({ Feature1: true, Feature2: false }));

    const server = new TogglyServer({
      appKey: 'test-key',
      environment: 'Production',
      isDebug: false,
    });

    await expect(server.getFlags()).resolves.toEqual({ Feature1: true, Feature2: false });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns flagDefaults when failOnFetchError is false and no cache exists', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const server = new TogglyServer({
      appKey: 'test-key',
      environment: 'Production',
      flagDefaults: { Feature1: true },
      failOnFetchError: false,
      isDebug: false,
    });

    await expect(server.getFlags()).resolves.toEqual({ Feature1: true });
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Using flag defaults after fetch failure'),
    );

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('invokes onError when a fetch fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const onError = vi.fn();

    const server = new TogglyServer({
      appKey: 'test-key',
      environment: 'Production',
      onError,
      isDebug: false,
    });

    await expect(server.refreshFlags()).rejects.toBeInstanceOf(TogglyFetchError);
    expect(onError).toHaveBeenCalledWith(
      'Error fetching feature flags',
      expect.any(TogglyFetchError),
    );
  });
});
