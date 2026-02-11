/**
 * Tests for types and error classes
 */

import {
  TogglyError,
  TogglyNetworkError,
  TogglyConfigError,
  TogglyTimeoutError,
} from '../src/types';

describe('Error Classes', () => {
  describe('TogglyError', () => {
    it('should create error with message and code', () => {
      const error = new TogglyError('Test error', 'TEST_CODE');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('TogglyError');
      expect(error.cause).toBeUndefined();
    });

    it('should create error with cause', () => {
      const originalError = new Error('Original');
      const error = new TogglyError('Wrapped error', 'WRAPPED', originalError);

      expect(error.message).toBe('Wrapped error');
      expect(error.cause).toBe(originalError);
    });

    it('should be instance of Error', () => {
      const error = new TogglyError('Test', 'CODE');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TogglyError);
    });
  });

  describe('TogglyNetworkError', () => {
    it('should create network error', () => {
      const error = new TogglyNetworkError('Network failed');

      expect(error.message).toBe('Network failed');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.name).toBe('TogglyNetworkError');
    });

    it('should create network error with cause', () => {
      const fetchError = new Error('fetch failed');
      const error = new TogglyNetworkError('Network failed', fetchError);

      expect(error.cause).toBe(fetchError);
    });

    it('should be instance of TogglyError', () => {
      const error = new TogglyNetworkError('Network failed');

      expect(error).toBeInstanceOf(TogglyError);
      expect(error).toBeInstanceOf(TogglyNetworkError);
    });
  });

  describe('TogglyConfigError', () => {
    it('should create config error', () => {
      const error = new TogglyConfigError('Invalid config');

      expect(error.message).toBe('Invalid config');
      expect(error.code).toBe('CONFIG_ERROR');
      expect(error.name).toBe('TogglyConfigError');
    });

    it('should be instance of TogglyError', () => {
      const error = new TogglyConfigError('Invalid config');

      expect(error).toBeInstanceOf(TogglyError);
      expect(error).toBeInstanceOf(TogglyConfigError);
    });
  });

  describe('TogglyTimeoutError', () => {
    it('should create timeout error', () => {
      const error = new TogglyTimeoutError('Request timed out');

      expect(error.message).toBe('Request timed out');
      expect(error.code).toBe('TIMEOUT_ERROR');
      expect(error.name).toBe('TogglyTimeoutError');
    });

    it('should be instance of TogglyError', () => {
      const error = new TogglyTimeoutError('Timeout');

      expect(error).toBeInstanceOf(TogglyError);
      expect(error).toBeInstanceOf(TogglyTimeoutError);
    });
  });
});
