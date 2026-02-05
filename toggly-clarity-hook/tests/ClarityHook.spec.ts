import { ClarityHook } from '../src/ClarityHook';

describe('ClarityHook', () => {
  let mockClarity: jest.Mock;

  beforeEach(() => {
    mockClarity = jest.fn();
    (window as any).clarity = mockClarity;
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    delete (window as any).clarity;
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should create hook with default options', () => {
      const hook = new ClarityHook();
      expect(hook).toBeDefined();
    });

    it('should create hook with custom options', () => {
      const hook = new ClarityHook({
        enabled: false,
        eventPrefix: 'FF:',
        checkConsent: () => false,
      });
      expect(hook).toBeDefined();
    });

    it('should create hook with partial options', () => {
      const hook = new ClarityHook({ eventPrefix: 'Custom:' });
      expect(hook).toBeDefined();
    });

    it('should warn if Clarity is not available and hook is enabled', () => {
      delete (window as any).clarity;
      new ClarityHook();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Microsoft Clarity not detected')
      );
    });

    it('should not warn if Clarity is not available and hook is disabled', () => {
      delete (window as any).clarity;
      new ClarityHook({ enabled: false });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should not warn if Clarity is available', () => {
      new ClarityHook();
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe('getMetadata', () => {
    it('should return correct metadata with name', () => {
      const hook = new ClarityHook();
      const metadata = hook.getMetadata();
      expect(metadata).toEqual({ name: 'clarity-hook' });
    });
  });

  describe('afterEvaluation', () => {
    it('should send event to Clarity when result is true', () => {
      const hook = new ClarityHook();
      hook.afterEvaluation('my-feature', undefined, true);

      expect(mockClarity).toHaveBeenCalledTimes(1);
      expect(mockClarity).toHaveBeenCalledWith('event', 'FeatureFlag:my-feature');
    });

    it('should not send event when result is false', () => {
      const hook = new ClarityHook();
      hook.afterEvaluation('my-feature', undefined, false);

      expect(mockClarity).not.toHaveBeenCalled();
    });

    it('should use custom event prefix', () => {
      const hook = new ClarityHook({ eventPrefix: 'FF:' });
      hook.afterEvaluation('dark-mode', undefined, true);

      expect(mockClarity).toHaveBeenCalledWith('event', 'FF:dark-mode');
    });

    it('should use empty prefix when configured', () => {
      const hook = new ClarityHook({ eventPrefix: '' });
      hook.afterEvaluation('dark-mode', undefined, true);

      expect(mockClarity).toHaveBeenCalledWith('event', 'dark-mode');
    });

    it('should not send event when hook is disabled', () => {
      const hook = new ClarityHook({ enabled: false });
      hook.afterEvaluation('my-feature', undefined, true);

      expect(mockClarity).not.toHaveBeenCalled();
    });

    it('should not send event when consent is denied', () => {
      const hook = new ClarityHook({ checkConsent: () => false });
      hook.afterEvaluation('my-feature', undefined, true);

      expect(mockClarity).not.toHaveBeenCalled();
    });

    it('should send event when consent is granted', () => {
      const hook = new ClarityHook({ checkConsent: () => true });
      hook.afterEvaluation('my-feature', undefined, true);

      expect(mockClarity).toHaveBeenCalledTimes(1);
    });

    it('should respect dynamic consent changes', () => {
      let consentGiven = false;
      const hook = new ClarityHook({ checkConsent: () => consentGiven });

      hook.afterEvaluation('my-feature', undefined, true);
      expect(mockClarity).not.toHaveBeenCalled();

      consentGiven = true;
      hook.afterEvaluation('my-feature', undefined, true);
      expect(mockClarity).toHaveBeenCalledTimes(1);
    });

    it('should not send event when Clarity is not available', () => {
      delete (window as any).clarity;
      const hook = new ClarityHook({ enabled: true });

      hook.afterEvaluation('my-feature', undefined, true);
      // No error thrown, no calls made
      expect(mockClarity).not.toHaveBeenCalled();
    });

    it('should handle Clarity not being a function', () => {
      (window as any).clarity = 'not-a-function';
      const hook = new ClarityHook();

      hook.afterEvaluation('my-feature', undefined, true);
      // clarity is not a function, so isClarityAvailable() returns false
      expect(mockClarity).not.toHaveBeenCalled();
    });

    it('should handle EvaluationSeriesData being passed', () => {
      const hook = new ClarityHook();
      const data = { flagKey: 'my-feature', defaultValue: false };

      hook.afterEvaluation('my-feature', data, true);
      expect(mockClarity).toHaveBeenCalledWith('event', 'FeatureFlag:my-feature');
    });

    it('should handle multiple evaluations', () => {
      const hook = new ClarityHook();

      hook.afterEvaluation('feature-1', undefined, true);
      hook.afterEvaluation('feature-2', undefined, true);
      hook.afterEvaluation('feature-3', undefined, false);
      hook.afterEvaluation('feature-4', undefined, true);

      expect(mockClarity).toHaveBeenCalledTimes(3);
      expect(mockClarity).toHaveBeenCalledWith('event', 'FeatureFlag:feature-1');
      expect(mockClarity).toHaveBeenCalledWith('event', 'FeatureFlag:feature-2');
      expect(mockClarity).toHaveBeenCalledWith('event', 'FeatureFlag:feature-4');
    });
  });

  describe('Error Handling', () => {
    it('should catch and log errors from Clarity API', () => {
      mockClarity.mockImplementation(() => {
        throw new Error('Clarity internal error');
      });
      const hook = new ClarityHook();

      expect(() => {
        hook.afterEvaluation('my-feature', undefined, true);
      }).not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly Clarity Hook] Error sending event:',
        expect.any(Error)
      );
    });

    it('should not break SDK when Clarity throws', () => {
      mockClarity.mockImplementation(() => {
        throw new TypeError('Cannot read properties');
      });
      const hook = new ClarityHook();

      hook.afterEvaluation('feature-1', undefined, true);
      expect(console.error).toHaveBeenCalledTimes(1);

      // Subsequent calls should still work
      mockClarity.mockImplementation(() => {}); // Fix clarity
      hook.afterEvaluation('feature-2', undefined, true);
      expect(mockClarity).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty flag key', () => {
      const hook = new ClarityHook();
      hook.afterEvaluation('', undefined, true);

      expect(mockClarity).toHaveBeenCalledWith('event', 'FeatureFlag:');
    });

    it('should handle flag keys with special characters', () => {
      const hook = new ClarityHook();
      hook.afterEvaluation('my-app/feature.v2:enabled', undefined, true);

      expect(mockClarity).toHaveBeenCalledWith('event', 'FeatureFlag:my-app/feature.v2:enabled');
    });

    it('should handle flag keys with unicode characters', () => {
      const hook = new ClarityHook();
      hook.afterEvaluation('feature-\u00e9', undefined, true);

      expect(mockClarity).toHaveBeenCalledWith('event', 'FeatureFlag:feature-\u00e9');
    });

    it('should handle window being undefined (SSR)', () => {
      const originalWindow = global.window;
      // @ts-ignore - simulate SSR environment
      delete global.window;

      const hook = new ClarityHook({ enabled: true });

      // Should not throw, should not warn (no window to check)
      expect(() => {
        hook.afterEvaluation('my-feature', undefined, true);
      }).not.toThrow();

      global.window = originalWindow;
    });

    it('should handle checkConsent throwing an error', () => {
      const hook = new ClarityHook({
        checkConsent: () => { throw new Error('Consent error'); }
      });

      // The checkConsent error propagates since it's called synchronously before Clarity
      // This is by design - consent errors should be visible to the developer
      expect(() => {
        hook.afterEvaluation('my-feature', undefined, true);
      }).toThrow('Consent error');
    });

    it('should work when Clarity becomes available after initialization', () => {
      delete (window as any).clarity;
      const hook = new ClarityHook();

      // No Clarity available
      hook.afterEvaluation('feature-1', undefined, true);
      expect(mockClarity).not.toHaveBeenCalled();

      // Clarity loaded later
      (window as any).clarity = mockClarity;
      hook.afterEvaluation('feature-2', undefined, true);
      expect(mockClarity).toHaveBeenCalledWith('event', 'FeatureFlag:feature-2');
    });
  });

  describe('Performance', () => {
    it('should handle rapid successive calls efficiently', () => {
      const hook = new ClarityHook();
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        hook.afterEvaluation(`feature-${i}`, undefined, true);
      }

      const duration = performance.now() - startTime;
      expect(duration).toBeLessThan(100);
      expect(mockClarity).toHaveBeenCalledTimes(1000);
    });

    it('should short-circuit quickly when disabled', () => {
      const hook = new ClarityHook({ enabled: false });
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        hook.afterEvaluation(`feature-${i}`, undefined, true);
      }

      const duration = performance.now() - startTime;
      expect(duration).toBeLessThan(50);
      expect(mockClarity).not.toHaveBeenCalled();
    });

    it('should short-circuit quickly when result is false', () => {
      const hook = new ClarityHook();
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        hook.afterEvaluation(`feature-${i}`, undefined, false);
      }

      const duration = performance.now() - startTime;
      expect(duration).toBeLessThan(50);
      expect(mockClarity).not.toHaveBeenCalled();
    });
  });
});
