/**
 * Tests for action utilities
 */

import {
  createFeatureGatedAction,
  createTogglyAction,
  requireFeature,
  FeatureGatedActionOptions,
} from '../src/action';
import type { ActionFunctionArgs } from '@remix-run/server-runtime';

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

describe('createFeatureGatedAction', () => {
  const defaultOptions: FeatureGatedActionOptions = {
    appKey: 'test-app-key',
    environment: 'test',
  };

  const createMockActionArgs = (options?: {
    formData?: Record<string, string>;
  }): ActionFunctionArgs => {
    const request = new Request('https://example.com/action', {
      method: 'POST',
      body: options?.formData
        ? new URLSearchParams(options.formData)
        : undefined,
    });

    return {
      request,
      params: {},
      context: {},
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('without required features', () => {
    it('should execute handler when no required features', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const handler = jest.fn().mockResolvedValue({ success: true });
      const action = createFeatureGatedAction(defaultOptions, handler);

      const result = await action(createMockActionArgs());

      expect(handler).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should pass action args and toggly context to handler', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const handler = jest.fn().mockResolvedValue({ success: true });
      const action = createFeatureGatedAction(defaultOptions, handler);

      await action(createMockActionArgs());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ request: expect.any(Request) }),
        expect.objectContaining({
          client: expect.any(Object),
          flags: expect.any(Object),
          isEnabled: expect.any(Function),
          isDisabled: expect.any(Function),
          evaluateGate: expect.any(Function),
        })
      );
    });

    it('should allow using context methods in handler', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true, feature2: false }),
      });

      const handler = jest.fn().mockImplementation(async (args, toggly) => {
        const enabled = await toggly.isEnabled('feature1');
        const disabled = await toggly.isDisabled('feature2');
        const gateResult = await toggly.evaluateGate(['feature1'], 'all');
        return { enabled, disabled, gateResult };
      });
      const action = createFeatureGatedAction(defaultOptions, handler);

      const result = await action(createMockActionArgs());

      expect(result).toEqual({ enabled: true, disabled: true, gateResult: true });
    });
  });

  describe('with required features', () => {
    it('should execute handler when feature is enabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ premium: true }),
      });

      const handler = jest.fn().mockResolvedValue({ success: true });
      const action = createFeatureGatedAction(
        {
          ...defaultOptions,
          requiredFeatures: 'premium',
        },
        handler
      );

      const result = await action(createMockActionArgs());

      expect(handler).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should return 403 JSON response when feature is disabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ premium: false }),
      });

      const handler = jest.fn().mockResolvedValue({ success: true });
      const action = createFeatureGatedAction(
        {
          ...defaultOptions,
          requiredFeatures: 'premium',
        },
        handler
      );

      const result = (await action(createMockActionArgs())) as Response;

      expect(handler).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(403);

      const body = await result.json();
      expect(body.error).toBe('Feature is not available');
      expect(body.featureKeys).toEqual(['premium']);
    });

    it('should use custom error status and message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ premium: false }),
      });

      const action = createFeatureGatedAction(
        {
          ...defaultOptions,
          requiredFeatures: 'premium',
          errorStatus: 402,
          errorMessage: 'Upgrade required',
        },
        jest.fn()
      );

      const result = (await action(createMockActionArgs())) as Response;

      expect(result.status).toBe(402);
      const body = await result.json();
      expect(body.error).toBe('Upgrade required');
    });

    it('should redirect when redirectTo is specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ premium: false }),
      });

      const action = createFeatureGatedAction(
        {
          ...defaultOptions,
          requiredFeatures: 'premium',
          redirectTo: '/upgrade',
        },
        jest.fn()
      );

      const result = (await action(createMockActionArgs())) as Response;

      expect(result.status).toBe(302);
      expect(result.headers.get('location')).toBe('/upgrade');
    });

    it('should call custom onFeatureDisabled handler', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ premium: false }),
      });

      const customResponse = new Response('Custom response', { status: 451 });
      const onFeatureDisabled = jest.fn().mockReturnValue(customResponse);

      const action = createFeatureGatedAction(
        {
          ...defaultOptions,
          requiredFeatures: 'premium',
          onFeatureDisabled,
        },
        jest.fn()
      );

      const result = await action(createMockActionArgs());

      expect(onFeatureDisabled).toHaveBeenCalledWith(
        expect.any(Request),
        ['premium']
      );
      expect(result).toBe(customResponse);
    });
  });

  describe('with multiple required features', () => {
    it('should require all features by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true, feature2: false }),
      });

      const handler = jest.fn();
      const action = createFeatureGatedAction(
        {
          ...defaultOptions,
          requiredFeatures: ['feature1', 'feature2'],
        },
        handler
      );

      const result = (await action(createMockActionArgs())) as Response;

      expect(handler).not.toHaveBeenCalled();
      expect(result.status).toBe(403);
    });

    it('should pass when all features are enabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true, feature2: true }),
      });

      const handler = jest.fn().mockResolvedValue({ success: true });
      const action = createFeatureGatedAction(
        {
          ...defaultOptions,
          requiredFeatures: ['feature1', 'feature2'],
          requirement: 'all',
        },
        handler
      );

      const result = await action(createMockActionArgs());

      expect(handler).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should pass when any feature is enabled with requirement: any', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true, feature2: false }),
      });

      const handler = jest.fn().mockResolvedValue({ success: true });
      const action = createFeatureGatedAction(
        {
          ...defaultOptions,
          requiredFeatures: ['feature1', 'feature2'],
          requirement: 'any',
        },
        handler
      );

      const result = await action(createMockActionArgs());

      expect(handler).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  describe('with identity extraction', () => {
    it('should extract identity using getIdentity', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const getIdentity = jest.fn().mockResolvedValue('user-123');
      const action = createFeatureGatedAction(
        {
          ...defaultOptions,
          getIdentity,
        },
        jest.fn().mockResolvedValue({ success: true })
      );

      await action(createMockActionArgs());

      expect(getIdentity).toHaveBeenCalled();
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('u=user-123');
    });
  });
});

describe('createTogglyAction', () => {
  const defaultOptions = {
    appKey: 'test-app-key',
    environment: 'test',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('getClient', () => {
    it('should return the Toggly client', () => {
      const togglyAction = createTogglyAction(defaultOptions);
      const client = togglyAction.getClient();

      expect(client).toBeDefined();
      expect(typeof client.isEnabled).toBe('function');
    });
  });

  describe('init', () => {
    it('should initialize with request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const togglyAction = createTogglyAction(defaultOptions);
      const request = new Request('https://example.com');
      const context = await togglyAction.init(request);

      expect(context.client).toBeDefined();
      expect(context.flags).toEqual({ feature1: true });
      expect(typeof context.isEnabled).toBe('function');
      expect(typeof context.isDisabled).toBe('function');
      expect(typeof context.evaluateGate).toBe('function');
    });

    it('should allow using context methods', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true, feature2: false }),
      });

      const togglyAction = createTogglyAction(defaultOptions);
      const request = new Request('https://example.com');
      const context = await togglyAction.init(request);

      const enabled = await context.isEnabled('feature1');
      const disabled = await context.isDisabled('feature2');
      const gateResult = await context.evaluateGate(['feature1'], 'all');

      expect(enabled).toBe(true);
      expect(disabled).toBe(true);
      expect(gateResult).toBe(true);
    });

    it('should extract identity using getIdentity', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const togglyAction = createTogglyAction({
        ...defaultOptions,
        getIdentity: () => 'user-123',
      });
      const request = new Request('https://example.com');
      await togglyAction.init(request);

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('u=user-123');
    });
  });

  describe('requireFeature', () => {
    it('should create a feature-gated action', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ premium: true }),
      });

      const togglyAction = createTogglyAction(defaultOptions);
      const handler = jest.fn().mockResolvedValue({ success: true });
      const action = togglyAction.requireFeature('premium', handler);

      const args: ActionFunctionArgs = {
        request: new Request('https://example.com', { method: 'POST' }),
        params: {},
        context: {},
      };

      const result = await action(args);

      expect(handler).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should call onDisabled when feature is disabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ premium: false }),
      });

      const togglyAction = createTogglyAction(defaultOptions);
      const handler = jest.fn();
      const onDisabled = jest.fn().mockReturnValue(new Response('Disabled'));
      const action = togglyAction.requireFeature('premium', handler, onDisabled);

      const args: ActionFunctionArgs = {
        request: new Request('https://example.com', { method: 'POST' }),
        params: {},
        context: {},
      };

      await action(args);

      expect(handler).not.toHaveBeenCalled();
      expect(onDisabled).toHaveBeenCalled();
    });
  });

  describe('requireFeatures', () => {
    it('should create a multi-feature gated action', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true, feature2: true }),
      });

      const togglyAction = createTogglyAction(defaultOptions);
      const handler = jest.fn().mockResolvedValue({ success: true });
      const action = togglyAction.requireFeatures(
        ['feature1', 'feature2'],
        'all',
        handler
      );

      const args: ActionFunctionArgs = {
        request: new Request('https://example.com', { method: 'POST' }),
        params: {},
        context: {},
      };

      const result = await action(args);

      expect(handler).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should support any requirement', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true, feature2: false }),
      });

      const togglyAction = createTogglyAction(defaultOptions);
      const handler = jest.fn().mockResolvedValue({ success: true });
      const action = togglyAction.requireFeatures(
        ['feature1', 'feature2'],
        'any',
        handler
      );

      const args: ActionFunctionArgs = {
        request: new Request('https://example.com', { method: 'POST' }),
        params: {},
        context: {},
      };

      const result = await action(args);

      expect(handler).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });
});

describe('requireFeature', () => {
  const defaultOptions = {
    appKey: 'test-app-key',
    environment: 'test',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  it('should create a higher-order function for feature-gated actions', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ premium: true }),
    });

    const handler = jest.fn().mockResolvedValue({ success: true });
    const wrappedAction = requireFeature('premium', defaultOptions)(handler);

    const args: ActionFunctionArgs = {
      request: new Request('https://example.com', { method: 'POST' }),
      params: {},
      context: {},
    };

    const result = await wrappedAction(args);

    expect(handler).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('should block action when feature is disabled', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ premium: false }),
    });

    const handler = jest.fn();
    const wrappedAction = requireFeature('premium', defaultOptions)(handler);

    const args: ActionFunctionArgs = {
      request: new Request('https://example.com', { method: 'POST' }),
      params: {},
      context: {},
    };

    const result = (await wrappedAction(args)) as Response;

    expect(handler).not.toHaveBeenCalled();
    expect(result.status).toBe(403);
  });

  it('should call custom onDisabled handler', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ premium: false }),
    });

    const customResponse = new Response('Upgrade required', { status: 402 });
    const onDisabled = jest.fn().mockReturnValue(customResponse);
    const handler = jest.fn();

    const wrappedAction = requireFeature(
      'premium',
      defaultOptions,
      onDisabled
    )(handler);

    const args: ActionFunctionArgs = {
      request: new Request('https://example.com', { method: 'POST' }),
      params: {},
      context: {},
    };

    const result = await wrappedAction(args);

    expect(onDisabled).toHaveBeenCalled();
    expect(result).toBe(customResponse);
  });
});
