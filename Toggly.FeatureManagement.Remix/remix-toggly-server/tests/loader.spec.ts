/**
 * Tests for loader utilities
 */

import {
  createTogglyLoader,
  getFeatureFlags,
  isFeatureEnabled,
  TogglyLoaderOptions,
} from '../src/loader';
import { HEADERS, STORAGE_KEYS, TOGGLY_LOADER_KEY } from '@ops-ai/remix-toggly-core';
import { featureDefs, mockDefsFetchResponse } from './defs-helpers';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock WebSocket to prevent real connections in unit tests
jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
    removeAllListeners: jest.fn(),
    send: jest.fn(),
    readyState: 1,
  }));
});

describe('createTogglyLoader', () => {
  const defaultOptions: TogglyLoaderOptions = {
    appKey: 'test-app-key',
    environment: 'test',
  };

  const createMockRequest = (options?: {
    headers?: Record<string, string>;
    cookies?: string;
  }): Request => {
    const headers = new Headers();

    if (options?.headers) {
      Object.entries(options.headers).forEach(([key, value]) => {
        headers.set(key, value);
      });
    }

    if (options?.cookies) {
      headers.set('cookie', options.cookies);
    }

    return new Request('https://example.com/test', { headers });
  };

  const createMockLoaderArgs = (request: Request) => ({
    request,
    params: {},
    context: {},
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getClient', () => {
    it('should return the Toggly client', () => {
      const loader = createTogglyLoader(defaultOptions);
      const client = loader.getClient();

      expect(client).toBeDefined();
      expect(typeof client.isEnabled).toBe('function');
    });
  });

  describe('load', () => {
    it('should load feature flags', async () => {
      const flags = { feature1: true, feature2: false };
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse(flags));

      const loader = createTogglyLoader(defaultOptions);
      const request = createMockRequest();
      const result = await loader.load(createMockLoaderArgs(request));

      expect(result).toEqual({
        flags,
        identity: undefined,
        appKey: 'test-app-key',
        environment: 'test',
        fetchedAt: expect.any(Number),
      });
    });

    it('should extract identity from custom getIdentity function', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({}));

      const options: TogglyLoaderOptions = {
        ...defaultOptions,
        getIdentity: (request) => 'custom-user-id',
      };

      const loader = createTogglyLoader(options);
      const request = createMockRequest();
      const result = await loader.load(createMockLoaderArgs(request));

      expect(result.identity).toBe('custom-user-id');
    });

    it('should extract identity from async getIdentity function', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({}));

      const options: TogglyLoaderOptions = {
        ...defaultOptions,
        getIdentity: async (request) => 'async-user-id',
      };

      const loader = createTogglyLoader(options);
      const request = createMockRequest();
      const result = await loader.load(createMockLoaderArgs(request));

      expect(result.identity).toBe('async-user-id');
    });

    it('should extract identity from header', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({}));

      const loader = createTogglyLoader(defaultOptions);
      const request = createMockRequest({
        headers: { [HEADERS.IDENTITY]: 'header-user-id' },
      });
      const result = await loader.load(createMockLoaderArgs(request));

      expect(result.identity).toBe('header-user-id');
    });

    it('should extract identity from cookies', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({}));

      const loader = createTogglyLoader(defaultOptions);
      const request = createMockRequest({
        cookies: `${STORAGE_KEYS.IDENTITY}=cookie-user-id`,
      });
      const result = await loader.load(createMockLoaderArgs(request));

      expect(result.identity).toBe('cookie-user-id');
    });

    it('should use custom cookie parser', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({}));

      const options: TogglyLoaderOptions = {
        ...defaultOptions,
        getIdentityFromCookies: (cookies) => 'custom-parsed-id',
      };

      const loader = createTogglyLoader(options);
      const request = createMockRequest({ cookies: 'some=cookie' });
      const result = await loader.load(createMockLoaderArgs(request));

      expect(result.identity).toBe('custom-parsed-id');
    });

    it('should handle URL-encoded cookie values', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({}));

      const loader = createTogglyLoader(defaultOptions);
      const request = createMockRequest({
        cookies: `${STORAGE_KEYS.IDENTITY}=${encodeURIComponent('user@example.com')}`,
      });
      const result = await loader.load(createMockLoaderArgs(request));

      expect(result.identity).toBe('user@example.com');
    });

    it('should return raw cookie value when percent-decoding fails', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({}));

      const loader = createTogglyLoader(defaultOptions);
      // %xx is invalid percent-encoding, causing decodeURIComponent to throw
      const request = createMockRequest({
        cookies: `${STORAGE_KEYS.IDENTITY}=user%xxid`,
      });
      const result = await loader.load(createMockLoaderArgs(request));

      expect(result.identity).toBe('user%xxid');
    });

    it('should return undefined identity when cookie header has no identity key', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({}));

      const loader = createTogglyLoader(defaultOptions);
      const request = createMockRequest({
        cookies: 'sessionId=abc123; theme=dark',
      });
      const result = await loader.load(createMockLoaderArgs(request));

      expect(result.identity).toBeUndefined();
    });
  });

  describe('getLoaderData', () => {
    it('should return loader data with feature context', async () => {
      const flags = { feature1: true };
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse(flags));

      const loader = createTogglyLoader(defaultOptions);
      const request = createMockRequest();
      const result = await loader.getLoaderData(createMockLoaderArgs(request));

      expect(result[TOGGLY_LOADER_KEY]).toBeDefined();
      expect(result[TOGGLY_LOADER_KEY].flags).toEqual(flags);
    });

    it('should merge with additional data', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({}));

      const loader = createTogglyLoader(defaultOptions);
      const request = createMockRequest();
      const result = await loader.getLoaderData(createMockLoaderArgs(request), {
        customData: 'value',
        items: [1, 2, 3],
      });

      expect(result.customData).toBe('value');
      expect(result.items).toEqual([1, 2, 3]);
      expect(result[TOGGLY_LOADER_KEY]).toBeDefined();
    });
  });

  describe('isEnabled', () => {
    it('should check if feature is enabled', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({ feature1: true }));

      const loader = createTogglyLoader(defaultOptions);
      // Initialize first
      await loader.load(createMockLoaderArgs(createMockRequest()));

      const result = await loader.isEnabled('feature1');

      expect(result).toBe(true);
    });

    it('should return default value for missing feature', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({}));

      const loader = createTogglyLoader(defaultOptions);
      await loader.load(createMockLoaderArgs(createMockRequest()));

      const result = await loader.isEnabled('missing', true);

      expect(result).toBe(true);
    });

    it('should evaluate with request identity without stale shared identity', async () => {
      const targetingAlice = {
        featureKey: 'targeted-flag',
        filters: [
          {
            name: 'Targeting',
            parameters: {
              'Audience.Users:0': 'alice',
              'Audience.DefaultRolloutPercentage': 0,
            },
          },
        ],
      };
      const body = JSON.stringify([targetingAlice]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(body),
        json: () => Promise.resolve([targetingAlice]),
        headers: { get: () => null },
      });

      const loader = createTogglyLoader({
        ...defaultOptions,
        getIdentity: async (request) =>
          request.headers.get('x-user-id') ?? undefined,
      });

      const bobCtx = await loader.load(
        createMockLoaderArgs(
          createMockRequest({ headers: { 'x-user-id': 'bob' } }),
        ),
      );
      expect(bobCtx.flags['targeted-flag']).toBe(false);
      expect(await loader.isEnabled('targeted-flag', false, bobCtx.identity)).toBe(
        false,
      );

      const aliceCtx = await loader.load(
        createMockLoaderArgs(
          createMockRequest({ headers: { 'x-user-id': 'alice' } }),
        ),
      );
      expect(aliceCtx.flags['targeted-flag']).toBe(true);
      expect(
        await loader.isEnabled('targeted-flag', false, aliceCtx.identity),
      ).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should keep request-local snapshots under concurrent loads', async () => {
      const targetingAlice = {
        featureKey: 'targeted-flag',
        filters: [
          {
            name: 'Targeting',
            parameters: {
              'Audience.Users:0': 'alice',
              'Audience.DefaultRolloutPercentage': 0,
            },
          },
        ],
      };
      const body = JSON.stringify([targetingAlice]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(body),
        json: () => Promise.resolve([targetingAlice]),
        headers: { get: () => null },
      });

      const loader = createTogglyLoader({
        ...defaultOptions,
        getIdentity: async (request) =>
          request.headers.get('x-user-id') ?? undefined,
      });

      const [bobCtx, aliceCtx, anonCtx] = await Promise.all([
        loader.load(
          createMockLoaderArgs(
            createMockRequest({ headers: { 'x-user-id': 'bob' } }),
          ),
        ),
        loader.load(
          createMockLoaderArgs(
            createMockRequest({ headers: { 'x-user-id': 'alice' } }),
          ),
        ),
        loader.load(createMockLoaderArgs(createMockRequest())),
      ]);

      expect(bobCtx.flags['targeted-flag']).toBe(false);
      expect(aliceCtx.flags['targeted-flag']).toBe(true);
      expect(anonCtx.flags['targeted-flag']).toBe(false);
      expect(anonCtx.identity).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('isDisabled', () => {
    it('should check if feature is disabled', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({ feature1: false }));

      const loader = createTogglyLoader(defaultOptions);
      await loader.load(createMockLoaderArgs(createMockRequest()));

      const result = await loader.isDisabled('feature1');

      expect(result).toBe(true);
    });
  });

  describe('evaluateGate', () => {
    it('should evaluate feature gate', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({ feature1: true, feature2: true }));

      const loader = createTogglyLoader(defaultOptions);
      await loader.load(createMockLoaderArgs(createMockRequest()));

      const result = await loader.evaluateGate(['feature1', 'feature2'], 'all');

      expect(result).toBe(true);
    });

    it('should evaluate gate with any requirement', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({ feature1: true, feature2: false }));

      const loader = createTogglyLoader(defaultOptions);
      await loader.load(createMockLoaderArgs(createMockRequest()));

      const result = await loader.evaluateGate(['feature1', 'feature2'], 'any');

      expect(result).toBe(true);
    });

    it('should negate gate result', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({ feature1: true }));

      const loader = createTogglyLoader(defaultOptions);
      await loader.load(createMockLoaderArgs(createMockRequest()));

      const result = await loader.evaluateGate(['feature1'], 'all', true);

      expect(result).toBe(false);
    });

    it('should default to "all" requirement when not specified', async () => {
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({ feature1: true, feature2: true }));

      const loader = createTogglyLoader(defaultOptions);
      await loader.load(createMockLoaderArgs(createMockRequest()));

      const result = await loader.evaluateGate(['feature1', 'feature2']);

      expect(result).toBe(true);
    });
  });

  describe('getFlags', () => {
    it('should return all flags', async () => {
      const flags = { feature1: true, feature2: false };
      mockFetch.mockResolvedValueOnce(mockDefsFetchResponse(flags));

      const loader = createTogglyLoader(defaultOptions);
      await loader.load(createMockLoaderArgs(createMockRequest()));

      const result = loader.getFlags();

      expect(result).toEqual(flags);
    });
  });
});

describe('getFeatureFlags', () => {
  const defaultOptions: TogglyLoaderOptions = {
    appKey: 'test-app-key',
    environment: 'test',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should get feature flags for a request', async () => {
    const flags = { feature1: true };
    mockFetch.mockResolvedValueOnce(mockDefsFetchResponse(flags));

    const request = new Request('https://example.com');
    const result = await getFeatureFlags(request, defaultOptions);

    expect(result.flags).toEqual(flags);
    expect(result.appKey).toBe('test-app-key');
    expect(result.environment).toBe('test');
  });
});

describe('isFeatureEnabled', () => {
  const defaultOptions: TogglyLoaderOptions = {
    appKey: 'test-app-key',
    environment: 'test',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should check if feature is enabled for a request', async () => {
    mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({ feature1: true }));

    const request = new Request('https://example.com');
    const result = await isFeatureEnabled(request, 'feature1', defaultOptions);

    expect(result).toBe(true);
  });

  it('should return default value when feature not found', async () => {
    mockFetch.mockResolvedValueOnce(mockDefsFetchResponse({}));

    const request = new Request('https://example.com');
    const result = await isFeatureEnabled(
      request,
      'missing',
      defaultOptions,
      true
    );

    expect(result).toBe(true);
  });
});
