/**
 * Tests for constants
 */

import {
  DEFAULT_BASE_URL,
  DEFAULT_ENVIRONMENT,
  DEFAULT_TIMEOUT,
  STORAGE_KEYS,
  HEADERS,
  REQUIREMENT,
  ERROR_CODES,
  TOGGLY_LOADER_KEY,
} from '../src/constants';

describe('Constants', () => {
  describe('DEFAULT_BASE_URL', () => {
    it('should be the correct Toggly API URL', () => {
      expect(DEFAULT_BASE_URL).toBe('https://client.toggly.io');
    });
  });

  describe('DEFAULT_ENVIRONMENT', () => {
    it('should be Production', () => {
      expect(DEFAULT_ENVIRONMENT).toBe('Production');
    });
  });

  describe('DEFAULT_TIMEOUT', () => {
    it('should be 10 seconds', () => {
      expect(DEFAULT_TIMEOUT).toBe(10000);
    });
  });

  describe('STORAGE_KEYS', () => {
    it('should have identity key', () => {
      expect(STORAGE_KEYS.IDENTITY).toBe('toggly_identity');
    });

    it('should have flags key', () => {
      expect(STORAGE_KEYS.FLAGS).toBe('toggly_flags');
    });

    it('should have config key', () => {
      expect(STORAGE_KEYS.CONFIG).toBe('toggly_config');
    });

    it('should have last fetch key', () => {
      expect(STORAGE_KEYS.LAST_FETCH).toBe('toggly_last_fetch');
    });
  });

  describe('HEADERS', () => {
    it('should have identity header', () => {
      expect(HEADERS.IDENTITY).toBe('x-toggly-identity');
    });

    it('should have flags header', () => {
      expect(HEADERS.FLAGS).toBe('x-toggly-flags');
    });

    it('should have cache control header', () => {
      expect(HEADERS.CACHE_CONTROL).toBe('cache-control');
    });
  });

  describe('REQUIREMENT', () => {
    it('should have ALL requirement', () => {
      expect(REQUIREMENT.ALL).toBe('all');
    });

    it('should have ANY requirement', () => {
      expect(REQUIREMENT.ANY).toBe('any');
    });
  });

  describe('ERROR_CODES', () => {
    it('should have network error code', () => {
      expect(ERROR_CODES.NETWORK_ERROR).toBe('NETWORK_ERROR');
    });

    it('should have config error code', () => {
      expect(ERROR_CODES.CONFIG_ERROR).toBe('CONFIG_ERROR');
    });

    it('should have timeout error code', () => {
      expect(ERROR_CODES.TIMEOUT_ERROR).toBe('TIMEOUT_ERROR');
    });

    it('should have parse error code', () => {
      expect(ERROR_CODES.PARSE_ERROR).toBe('PARSE_ERROR');
    });

    it('should have unknown error code', () => {
      expect(ERROR_CODES.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');
    });
  });

  describe('TOGGLY_LOADER_KEY', () => {
    it('should be __toggly', () => {
      expect(TOGGLY_LOADER_KEY).toBe('__toggly');
    });
  });
});
