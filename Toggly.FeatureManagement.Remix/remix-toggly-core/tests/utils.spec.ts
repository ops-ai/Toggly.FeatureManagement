/**
 * Tests for utility functions
 */

import {
  mergeConfig,
  buildDefinitionsUrl,
  isFeatureEnabled,
  evaluateFeatureGate,
  normalizeFeatureKeys,
  createLogger,
  parseIdentity,
  serializeFlags,
  deserializeFlags,
  isServer,
  isClient,
  fetchWithTimeout,
  createTimeout,
  DEFAULT_CONFIG,
} from '../src/utils';
import type { FeatureFlags, TogglyConfig } from '../src/types';

describe('utils', () => {
  describe('mergeConfig', () => {
    it('should merge user config with defaults', () => {
      const userConfig: TogglyConfig = {
        appKey: 'test-key',
        environment: 'Staging',
      };

      const result = mergeConfig(userConfig);

      expect(result.appKey).toBe('test-key');
      expect(result.environment).toBe('Staging');
      expect(result.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
      expect(result.timeout).toBe(DEFAULT_CONFIG.timeout);
    });

    it('should override defaults with user config', () => {
      const userConfig: TogglyConfig = {
        appKey: 'test-key',
        baseUrl: 'https://custom.api.com',
        timeout: 5000,
      };

      const result = mergeConfig(userConfig);

      expect(result.baseUrl).toBe('https://custom.api.com');
      expect(result.timeout).toBe(5000);
    });

    it('should handle empty config', () => {
      const result = mergeConfig({});

      expect(result.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
      expect(result.environment).toBe(DEFAULT_CONFIG.environment);
    });
  });

  describe('buildDefinitionsUrl', () => {
    it('should build URL without identity', () => {
      const config: TogglyConfig = {
        appKey: 'my-app',
        environment: 'Production',
      };

      const url = buildDefinitionsUrl(config);

      expect(url).toBe('https://client.toggly.io/my-app-Production/defs');
    });

    it('should build URL with identity', () => {
      const config: TogglyConfig = {
        appKey: 'my-app',
        environment: 'Production',
      };

      const url = buildDefinitionsUrl(config, 'user-123');

      expect(url).toBe('https://client.toggly.io/my-app-Production/defs?u=user-123');
    });

    it('should encode identity in URL', () => {
      const config: TogglyConfig = {
        appKey: 'my-app',
        environment: 'Production',
      };

      const url = buildDefinitionsUrl(config, 'user@example.com');

      expect(url).toBe('https://client.toggly.io/my-app-Production/defs?u=user%40example.com');
    });

    it('should use custom base URL', () => {
      const config: TogglyConfig = {
        appKey: 'my-app',
        environment: 'Staging',
        baseUrl: 'https://custom.api.com',
      };

      const url = buildDefinitionsUrl(config);

      expect(url).toBe('https://custom.api.com/my-app-Staging/defs');
    });

    it('should throw error without appKey', () => {
      const config: TogglyConfig = {
        environment: 'Production',
      };

      expect(() => buildDefinitionsUrl(config)).toThrow('appKey is required');
    });

    it('should use default environment when not provided', () => {
      const config: TogglyConfig = {
        appKey: 'my-app',
      };

      const url = buildDefinitionsUrl(config);

      expect(url).toContain('Production');
    });
  });

  describe('isFeatureEnabled', () => {
    const flags: FeatureFlags = {
      'feature-a': true,
      'feature-b': false,
      'feature-c': true,
    };

    it('should return true for enabled feature', () => {
      expect(isFeatureEnabled(flags, 'feature-a')).toBe(true);
    });

    it('should return false for disabled feature', () => {
      expect(isFeatureEnabled(flags, 'feature-b')).toBe(false);
    });

    it('should return default for unknown feature', () => {
      expect(isFeatureEnabled(flags, 'unknown')).toBe(false);
      expect(isFeatureEnabled(flags, 'unknown', true)).toBe(true);
    });

    it('should return default for empty flags', () => {
      expect(isFeatureEnabled({}, 'feature-a')).toBe(false);
      expect(isFeatureEnabled({}, 'feature-a', true)).toBe(true);
    });

    it('should handle null/undefined flags', () => {
      expect(isFeatureEnabled(null as unknown as FeatureFlags, 'feature')).toBe(false);
      expect(isFeatureEnabled(undefined as unknown as FeatureFlags, 'feature', true)).toBe(true);
    });
  });

  describe('evaluateFeatureGate', () => {
    const flags: FeatureFlags = {
      'feature-a': true,
      'feature-b': false,
      'feature-c': true,
    };

    describe('all requirement', () => {
      it('should return true when all features are enabled', () => {
        const result = evaluateFeatureGate(flags, ['feature-a', 'feature-c'], 'all');
        expect(result.enabled).toBe(true);
        expect(result.requirement).toBe('all');
      });

      it('should return false when any feature is disabled', () => {
        const result = evaluateFeatureGate(flags, ['feature-a', 'feature-b'], 'all');
        expect(result.enabled).toBe(false);
      });

      it('should return false when all features are disabled', () => {
        const result = evaluateFeatureGate(flags, ['feature-b'], 'all');
        expect(result.enabled).toBe(false);
      });
    });

    describe('any requirement', () => {
      it('should return true when any feature is enabled', () => {
        const result = evaluateFeatureGate(flags, ['feature-a', 'feature-b'], 'any');
        expect(result.enabled).toBe(true);
        expect(result.requirement).toBe('any');
      });

      it('should return false when all features are disabled', () => {
        const result = evaluateFeatureGate(flags, ['feature-b'], 'any');
        expect(result.enabled).toBe(false);
      });

      it('should return true when all features are enabled', () => {
        const result = evaluateFeatureGate(flags, ['feature-a', 'feature-c'], 'any');
        expect(result.enabled).toBe(true);
      });
    });

    describe('negation', () => {
      it('should negate true to false', () => {
        const result = evaluateFeatureGate(flags, ['feature-a'], 'all', true);
        expect(result.enabled).toBe(false);
        expect(result.negated).toBe(true);
      });

      it('should negate false to true', () => {
        const result = evaluateFeatureGate(flags, ['feature-b'], 'all', true);
        expect(result.enabled).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle empty feature keys', () => {
        const result = evaluateFeatureGate(flags, [], 'all');
        expect(result.enabled).toBe(true);
      });

      it('should handle empty feature keys with negate', () => {
        const result = evaluateFeatureGate(flags, [], 'all', true);
        expect(result.enabled).toBe(false);
      });

      it('should handle empty flags', () => {
        const result = evaluateFeatureGate({}, ['feature-a'], 'all');
        expect(result.enabled).toBe(false);
      });

      it('should handle empty flags with negate', () => {
        const result = evaluateFeatureGate({}, ['feature-a'], 'all', true);
        expect(result.enabled).toBe(true);
      });

      it('should handle empty flags with default value', () => {
        const result = evaluateFeatureGate({}, ['feature-a'], 'all', false, true);
        expect(result.enabled).toBe(true);
      });

      it('should handle empty flags with negate and default value', () => {
        const result = evaluateFeatureGate({}, ['feature-a'], 'all', true, true);
        expect(result.enabled).toBe(false);
      });

      it('should return feature keys in result', () => {
        const result = evaluateFeatureGate(flags, ['feature-a', 'feature-b'], 'all');
        expect(result.featureKeys).toEqual(['feature-a', 'feature-b']);
      });

      it('should use default requirement when not provided', () => {
        const result = evaluateFeatureGate(flags, ['feature-a']);
        expect(result.requirement).toBe('all');
      });
    });
  });

  describe('normalizeFeatureKeys', () => {
    it('should handle single feature key', () => {
      const result = normalizeFeatureKeys('feature-a');
      expect(result).toEqual(['feature-a']);
    });

    it('should handle multiple feature keys', () => {
      const result = normalizeFeatureKeys(undefined, ['feature-a', 'feature-b']);
      expect(result).toEqual(['feature-a', 'feature-b']);
    });

    it('should combine featureKey and featureKeys', () => {
      const result = normalizeFeatureKeys('feature-a', ['feature-b', 'feature-c']);
      expect(result).toEqual(['feature-a', 'feature-b', 'feature-c']);
    });

    it('should remove duplicates', () => {
      const result = normalizeFeatureKeys('feature-a', ['feature-a', 'feature-b']);
      expect(result).toEqual(['feature-a', 'feature-b']);
    });

    it('should handle empty inputs', () => {
      const result = normalizeFeatureKeys();
      expect(result).toEqual([]);
    });
  });

  describe('createLogger', () => {
    let consoleDebugSpy: jest.SpyInstance;
    let consoleInfoSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
      consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should log debug messages when debug is true', () => {
      const logger = createLogger(true);
      logger.debug('test message');
      expect(consoleDebugSpy).toHaveBeenCalledWith('[Toggly]', 'test message');
    });

    it('should not log debug messages when debug is false', () => {
      const logger = createLogger(false);
      logger.debug('test message');
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should always log warnings', () => {
      const logger = createLogger(false);
      logger.warn('warning message');
      expect(consoleWarnSpy).toHaveBeenCalledWith('[Toggly]', 'warning message');
    });

    it('should always log errors', () => {
      const logger = createLogger(false);
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Toggly]', 'error message');
    });

    it('should log info messages when debug is true', () => {
      const logger = createLogger(true);
      logger.info('info message');
      expect(consoleInfoSpy).toHaveBeenCalledWith('[Toggly]', 'info message');
    });

    it('should not log info messages when debug is false', () => {
      const logger = createLogger(false);
      logger.info('info message');
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });
  });

  describe('parseIdentity', () => {
    it('should return string identity as-is', () => {
      expect(parseIdentity('user-123')).toBe('user-123');
    });

    it('should parse JSON string', () => {
      expect(parseIdentity('"user-123"')).toBe('user-123');
    });

    it('should extract identity from JSON object', () => {
      expect(parseIdentity('{"identity":"user-123"}')).toBe('user-123');
      expect(parseIdentity('{"id":"user-456"}')).toBe('user-456');
      expect(parseIdentity('{"userId":"user-789"}')).toBe('user-789');
      expect(parseIdentity('{"sub":"jwt-sub"}')).toBe('jwt-sub');
    });

    it('should handle null and undefined', () => {
      expect(parseIdentity(null)).toBeUndefined();
      expect(parseIdentity(undefined)).toBeUndefined();
    });

    it('should handle empty string', () => {
      expect(parseIdentity('')).toBeUndefined();
    });
  });

  describe('serializeFlags/deserializeFlags', () => {
    const flags: FeatureFlags = {
      'feature-a': true,
      'feature-b': false,
    };

    it('should serialize and deserialize flags', () => {
      const serialized = serializeFlags(flags);
      const deserialized = deserializeFlags(serialized);
      expect(deserialized).toEqual(flags);
    });

    it('should handle empty flags', () => {
      const serialized = serializeFlags({});
      const deserialized = deserializeFlags(serialized);
      expect(deserialized).toEqual({});
    });

    it('should return empty object for invalid JSON', () => {
      expect(deserializeFlags('invalid')).toEqual({});
    });

    it('should return empty object for null/undefined', () => {
      expect(deserializeFlags(null)).toEqual({});
      expect(deserializeFlags(undefined)).toEqual({});
    });
  });

  describe('isServer/isClient', () => {
    it('should detect server environment', () => {
      // In Jest, window is undefined by default
      expect(isServer()).toBe(true);
      expect(isClient()).toBe(false);
    });
  });

  describe('createTimeout', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should reject after specified timeout', async () => {
      const timeoutPromise = createTimeout(1000);

      jest.advanceTimersByTime(1000);

      await expect(timeoutPromise).rejects.toThrow('Request timed out after 1000ms');
    });
  });

  describe('fetchWithTimeout', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should fetch successfully within timeout', async () => {
      const mockResponse = new Response(JSON.stringify({ success: true }));
      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const responsePromise = fetchWithTimeout('https://example.com/api', {}, 5000);

      // Don't advance timers, let fetch resolve immediately
      jest.advanceTimersByTime(0);

      const response = await responsePromise;
      expect(response).toBe(mockResponse);
    });

    it('should abort on timeout', async () => {
      // Mock fetch to never resolve
      global.fetch = jest.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            // Simulate AbortController behavior
            setTimeout(() => reject(new Error('Aborted')), 100);
          })
      );

      const fetchPromise = fetchWithTimeout('https://example.com/api', {}, 100);

      jest.advanceTimersByTime(150);

      await expect(fetchPromise).rejects.toThrow();
    });

    it('should use default options and timeout', async () => {
      const mockResponse = new Response(JSON.stringify({ success: true }));
      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const responsePromise = fetchWithTimeout('https://example.com/api');

      jest.advanceTimersByTime(0);

      const response = await responsePromise;
      expect(response).toBe(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });
});
