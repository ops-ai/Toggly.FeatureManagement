import { GA4Hook } from '../src/GA4Hook';

describe('GA4Hook', () => {
  let mockGtag: jest.Mock;

  beforeEach(() => {
    mockGtag = jest.fn();
    (window as any).gtag = mockGtag;
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    delete (window as any).gtag;
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should create hook with default options', () => {
      const hook = new GA4Hook();
      expect(hook).toBeDefined();
    });

    it('should create hook with custom options', () => {
      const hook = new GA4Hook({
        enabled: false,
        measurementId: 'G-TEST123',
        evaluationEventName: 'custom_eval',
        changeEventName: 'custom_change',
        trackEvaluations: true,
        trackAllResults: false,
        setUserProperties: true,
        userPropertyPrefix: 'test_',
        trackChanges: true,
        trackIdentity: true,
        customParameters: { app_version: '1.0.0' },
        checkConsent: () => false,
        debug: true,
      });
      expect(hook).toBeDefined();
    });

    it('should create hook with partial options', () => {
      const hook = new GA4Hook({ measurementId: 'G-TEST123' });
      expect(hook).toBeDefined();
    });

    it('should warn if gtag is not available and hook is enabled', () => {
      delete (window as any).gtag;
      new GA4Hook();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Google Analytics 4 gtag not detected')
      );
    });

    it('should not warn if gtag is not available and hook is disabled', () => {
      delete (window as any).gtag;
      new GA4Hook({ enabled: false });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should not warn if gtag is available', () => {
      new GA4Hook();
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe('getMetadata', () => {
    it('should return correct metadata with name', () => {
      const hook = new GA4Hook();
      const metadata = hook.getMetadata();
      expect(metadata).toEqual({ name: 'ga4-hook' });
    });
  });

  describe('afterEvaluation', () => {
    it('should send event to GA4 when result is true', () => {
      const hook = new GA4Hook();
      hook.afterEvaluation('my-feature', undefined, true);

      expect(mockGtag).toHaveBeenCalledTimes(1);
      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_evaluated', {
        feature_key: 'my-feature',
        feature_enabled: true,
        event_category: 'toggly',
      });
    });

    it('should send event when result is false with trackAllResults enabled', () => {
      const hook = new GA4Hook({ trackAllResults: true });
      hook.afterEvaluation('my-feature', undefined, false);

      expect(mockGtag).toHaveBeenCalledTimes(1);
      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_evaluated', {
        feature_key: 'my-feature',
        feature_enabled: false,
        event_category: 'toggly',
      });
    });

    it('should not send event when result is false with trackAllResults disabled', () => {
      const hook = new GA4Hook({ trackAllResults: false });
      hook.afterEvaluation('my-feature', undefined, false);

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should use custom event name', () => {
      const hook = new GA4Hook({ evaluationEventName: 'custom_ff_eval' });
      hook.afterEvaluation('dark-mode', undefined, true);

      expect(mockGtag).toHaveBeenCalledWith('event', 'custom_ff_eval', expect.any(Object));
    });

    it('should include measurement ID when provided', () => {
      const hook = new GA4Hook({ measurementId: 'G-TEST123' });
      hook.afterEvaluation('my-feature', undefined, true);

      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_evaluated', {
        send_to: 'G-TEST123',
        feature_key: 'my-feature',
        feature_enabled: true,
        event_category: 'toggly',
      });
    });

    it('should include custom parameters', () => {
      const hook = new GA4Hook({ customParameters: { app_version: '2.0.0', environment: 'prod' } });
      hook.afterEvaluation('my-feature', undefined, true);

      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_evaluated', {
        feature_key: 'my-feature',
        feature_enabled: true,
        event_category: 'toggly',
        app_version: '2.0.0',
        environment: 'prod',
      });
    });

    it('should not send event when hook is disabled', () => {
      const hook = new GA4Hook({ enabled: false });
      hook.afterEvaluation('my-feature', undefined, true);

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should not send event when trackEvaluations is disabled', () => {
      const hook = new GA4Hook({ trackEvaluations: false });
      hook.afterEvaluation('my-feature', undefined, true);

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should not send event when consent is denied', () => {
      const hook = new GA4Hook({ checkConsent: () => false });
      hook.afterEvaluation('my-feature', undefined, true);

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should send event when consent is granted', () => {
      const hook = new GA4Hook({ checkConsent: () => true });
      hook.afterEvaluation('my-feature', undefined, true);

      expect(mockGtag).toHaveBeenCalledTimes(1);
    });

    it('should respect dynamic consent changes', () => {
      let consentGiven = false;
      const hook = new GA4Hook({ checkConsent: () => consentGiven });

      hook.afterEvaluation('my-feature', undefined, true);
      expect(mockGtag).not.toHaveBeenCalled();

      consentGiven = true;
      hook.afterEvaluation('my-feature', undefined, true);
      expect(mockGtag).toHaveBeenCalledTimes(1);
    });

    it('should not send event when gtag is not available', () => {
      delete (window as any).gtag;
      const hook = new GA4Hook({ enabled: true });

      hook.afterEvaluation('my-feature', undefined, true);
      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should handle gtag not being a function', () => {
      (window as any).gtag = 'not-a-function';
      const hook = new GA4Hook();

      hook.afterEvaluation('my-feature', undefined, true);
      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should handle EvaluationSeriesData being passed', () => {
      const hook = new GA4Hook();
      const data = { flagKey: 'my-feature', defaultValue: false };

      hook.afterEvaluation('my-feature', data, true);
      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_evaluated', expect.objectContaining({
        feature_key: 'my-feature',
      }));
    });

    it('should handle multiple evaluations', () => {
      const hook = new GA4Hook();

      hook.afterEvaluation('feature-1', undefined, true);
      hook.afterEvaluation('feature-2', undefined, true);
      hook.afterEvaluation('feature-3', undefined, false);
      hook.afterEvaluation('feature-4', undefined, true);

      expect(mockGtag).toHaveBeenCalledTimes(4);
    });

    it('should log in debug mode', () => {
      const hook = new GA4Hook({ debug: true });
      hook.afterEvaluation('my-feature', undefined, true);

      expect(console.log).toHaveBeenCalledWith(
        '[Toggly GA4 Hook] Evaluation tracked:',
        'my-feature',
        true
      );
    });
  });

  describe('afterEvaluation with User Properties', () => {
    it('should set user property when setUserProperties is enabled', () => {
      const hook = new GA4Hook({ setUserProperties: true });
      hook.afterEvaluation('dark-mode', undefined, true);

      expect(mockGtag).toHaveBeenCalledTimes(2);
      expect(mockGtag).toHaveBeenCalledWith('set', 'user_properties', {
        ff_dark_mode: 'on',
      });
    });

    it('should set user property to off when feature is disabled', () => {
      const hook = new GA4Hook({ setUserProperties: true, trackAllResults: true });
      hook.afterEvaluation('dark-mode', undefined, false);

      expect(mockGtag).toHaveBeenCalledWith('set', 'user_properties', {
        ff_dark_mode: 'off',
      });
    });

    it('should use custom user property prefix', () => {
      const hook = new GA4Hook({ setUserProperties: true, userPropertyPrefix: 'feature_' });
      hook.afterEvaluation('dark-mode', undefined, true);

      expect(mockGtag).toHaveBeenCalledWith('set', 'user_properties', {
        feature_dark_mode: 'on',
      });
    });

    it('should sanitize special characters in property names', () => {
      const hook = new GA4Hook({ setUserProperties: true });
      hook.afterEvaluation('my-app/feature', undefined, true);

      expect(mockGtag).toHaveBeenCalledWith('set', 'user_properties', {
        ff_my_app_feature: 'on',
      });
    });

    it('should truncate long property names', () => {
      const hook = new GA4Hook({ setUserProperties: true, userPropertyPrefix: 'ff_' });
      const longName = 'this_is_a_very_long_feature_name_that_exceeds_limit';
      hook.afterEvaluation(longName, undefined, true);

      // Max 24 chars, minus 3 for prefix = 21 chars for the name
      const calls = mockGtag.mock.calls.find(call => call[0] === 'set');
      expect(calls).toBeDefined();
      const propName = Object.keys(calls![2])[0];
      expect(propName.length).toBeLessThanOrEqual(24);
    });

    it('should not set user property when setUserProperties is disabled', () => {
      const hook = new GA4Hook({ setUserProperties: false });
      hook.afterEvaluation('dark-mode', undefined, true);

      expect(mockGtag).toHaveBeenCalledTimes(1);
      expect(mockGtag).not.toHaveBeenCalledWith('set', expect.anything(), expect.anything());
    });
  });

  describe('afterIdentify', () => {
    it('should set user_id with measurement ID', () => {
      const hook = new GA4Hook({ measurementId: 'G-TEST123' });
      hook.afterIdentify('user@example.com', undefined);

      expect(mockGtag).toHaveBeenCalledWith('config', 'G-TEST123', {
        user_id: 'user@example.com',
      });
    });

    it('should set user_id globally without measurement ID', () => {
      const hook = new GA4Hook();
      hook.afterIdentify('user@example.com', undefined);

      expect(mockGtag).toHaveBeenCalledWith('set', 'user_properties', {
        user_id: 'user@example.com',
      });
    });

    it('should not set user_id when hook is disabled', () => {
      const hook = new GA4Hook({ enabled: false });
      hook.afterIdentify('user@example.com', undefined);

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should not set user_id when trackIdentity is disabled', () => {
      const hook = new GA4Hook({ trackIdentity: false });
      hook.afterIdentify('user@example.com', undefined);

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should not set user_id when consent is denied', () => {
      const hook = new GA4Hook({ checkConsent: () => false });
      hook.afterIdentify('user@example.com', undefined);

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should not set user_id when gtag is not available', () => {
      delete (window as any).gtag;
      const hook = new GA4Hook({ enabled: true });
      hook.afterIdentify('user@example.com', undefined);

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should handle IdentitySeriesData being passed', () => {
      const hook = new GA4Hook();
      const data = { identity: 'user@example.com' };

      hook.afterIdentify('user@example.com', data);
      expect(mockGtag).toHaveBeenCalled();
    });

    it('should log in debug mode', () => {
      const hook = new GA4Hook({ debug: true });
      hook.afterIdentify('user@example.com', undefined);

      expect(console.log).toHaveBeenCalledWith(
        '[Toggly GA4 Hook] Identity set:',
        'user@example.com'
      );
    });
  });

  describe('afterRefresh', () => {
    it('should not send change events on first refresh', () => {
      const hook = new GA4Hook();
      hook.afterRefresh({ 'feature-1': true, 'feature-2': false });

      expect(mockGtag).not.toHaveBeenCalledWith('event', 'feature_flag_changed', expect.anything());
    });

    it('should set user properties on first refresh when enabled', () => {
      const hook = new GA4Hook({ setUserProperties: true });
      hook.afterRefresh({ 'feature-1': true, 'feature-2': false });

      expect(mockGtag).toHaveBeenCalledWith('set', 'user_properties', {
        ff_feature_1: 'on',
      });
      expect(mockGtag).toHaveBeenCalledWith('set', 'user_properties', {
        ff_feature_2: 'off',
      });
    });

    it('should send change events on subsequent refreshes', () => {
      const hook = new GA4Hook();

      // First refresh - no events
      hook.afterRefresh({ 'feature-1': true, 'feature-2': false });
      mockGtag.mockClear();

      // Second refresh with changes
      hook.afterRefresh({ 'feature-1': false, 'feature-2': true });

      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_changed', {
        feature_key: 'feature-1',
        old_value: true,
        new_value: false,
        event_category: 'toggly',
      });
      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_changed', {
        feature_key: 'feature-2',
        old_value: false,
        new_value: true,
        event_category: 'toggly',
      });
    });

    it('should not send events for unchanged features', () => {
      const hook = new GA4Hook();

      hook.afterRefresh({ 'feature-1': true, 'feature-2': false });
      mockGtag.mockClear();

      hook.afterRefresh({ 'feature-1': true, 'feature-2': false });

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should use custom change event name', () => {
      const hook = new GA4Hook({ changeEventName: 'ff_state_change' });

      hook.afterRefresh({ 'feature-1': true });
      mockGtag.mockClear();

      hook.afterRefresh({ 'feature-1': false });

      expect(mockGtag).toHaveBeenCalledWith('event', 'ff_state_change', expect.any(Object));
    });

    it('should include measurement ID when provided', () => {
      const hook = new GA4Hook({ measurementId: 'G-TEST123' });

      hook.afterRefresh({ 'feature-1': true });
      mockGtag.mockClear();

      hook.afterRefresh({ 'feature-1': false });

      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_changed', expect.objectContaining({
        send_to: 'G-TEST123',
      }));
    });

    it('should include custom parameters', () => {
      const hook = new GA4Hook({ customParameters: { app_version: '2.0.0' } });

      hook.afterRefresh({ 'feature-1': true });
      mockGtag.mockClear();

      hook.afterRefresh({ 'feature-1': false });

      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_changed', expect.objectContaining({
        app_version: '2.0.0',
      }));
    });

    it('should update user properties on change when enabled', () => {
      const hook = new GA4Hook({ setUserProperties: true });

      hook.afterRefresh({ 'feature-1': true });
      mockGtag.mockClear();

      hook.afterRefresh({ 'feature-1': false });

      expect(mockGtag).toHaveBeenCalledWith('set', 'user_properties', {
        ff_feature_1: 'off',
      });
    });

    it('should not send events when hook is disabled', () => {
      const hook = new GA4Hook({ enabled: false });

      hook.afterRefresh({ 'feature-1': true });
      hook.afterRefresh({ 'feature-1': false });

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should not send events when trackChanges is disabled', () => {
      const hook = new GA4Hook({ trackChanges: false });

      hook.afterRefresh({ 'feature-1': true });
      hook.afterRefresh({ 'feature-1': false });

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should not send events when consent is denied', () => {
      const hook = new GA4Hook({ checkConsent: () => false });

      hook.afterRefresh({ 'feature-1': true });
      hook.afterRefresh({ 'feature-1': false });

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should not send events when gtag is not available', () => {
      delete (window as any).gtag;
      const hook = new GA4Hook({ enabled: true });

      hook.afterRefresh({ 'feature-1': true });
      hook.afterRefresh({ 'feature-1': false });

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should handle new features appearing in refresh', () => {
      const hook = new GA4Hook();

      hook.afterRefresh({ 'feature-1': true });
      mockGtag.mockClear();

      // New feature added - should not trigger change event (no old value)
      hook.afterRefresh({ 'feature-1': true, 'feature-2': true });

      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should log in debug mode', () => {
      const hook = new GA4Hook({ debug: true });

      hook.afterRefresh({ 'feature-1': true });
      hook.afterRefresh({ 'feature-1': false });

      expect(console.log).toHaveBeenCalledWith(
        '[Toggly GA4 Hook] Feature changed:',
        'feature-1',
        true,
        '->',
        false
      );
    });
  });

  describe('Error Handling', () => {
    it('should catch and log errors from gtag API in afterEvaluation', () => {
      mockGtag.mockImplementation(() => {
        throw new Error('gtag internal error');
      });
      const hook = new GA4Hook();

      expect(() => {
        hook.afterEvaluation('my-feature', undefined, true);
      }).not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly GA4 Hook] Error sending evaluation event:',
        expect.any(Error)
      );
    });

    it('should catch and log errors from gtag API in afterIdentify', () => {
      mockGtag.mockImplementation(() => {
        throw new Error('gtag internal error');
      });
      const hook = new GA4Hook();

      expect(() => {
        hook.afterIdentify('user@example.com', undefined);
      }).not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly GA4 Hook] Error setting identity:',
        expect.any(Error)
      );
    });

    it('should catch and log errors from gtag API in afterRefresh', () => {
      const hook = new GA4Hook();
      hook.afterRefresh({ 'feature-1': true });

      mockGtag.mockImplementation(() => {
        throw new Error('gtag internal error');
      });

      expect(() => {
        hook.afterRefresh({ 'feature-1': false });
      }).not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly GA4 Hook] Error processing refresh:',
        expect.any(Error)
      );
    });

    it('should not break SDK when gtag throws', () => {
      mockGtag.mockImplementation(() => {
        throw new TypeError('Cannot read properties');
      });
      const hook = new GA4Hook();

      hook.afterEvaluation('feature-1', undefined, true);
      expect(console.error).toHaveBeenCalledTimes(1);

      // Subsequent calls should still work
      mockGtag.mockImplementation(() => {});
      hook.afterEvaluation('feature-2', undefined, true);
      expect(mockGtag).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty flag key', () => {
      const hook = new GA4Hook();
      hook.afterEvaluation('', undefined, true);

      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_evaluated', expect.objectContaining({
        feature_key: '',
      }));
    });

    it('should handle flag keys with special characters', () => {
      const hook = new GA4Hook();
      hook.afterEvaluation('my-app/feature.v2:enabled', undefined, true);

      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_evaluated', expect.objectContaining({
        feature_key: 'my-app/feature.v2:enabled',
      }));
    });

    it('should handle flag keys with unicode characters', () => {
      const hook = new GA4Hook();
      hook.afterEvaluation('feature-\u00e9', undefined, true);

      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_evaluated', expect.objectContaining({
        feature_key: 'feature-\u00e9',
      }));
    });

    it('should handle window being undefined (SSR)', () => {
      const originalWindow = global.window;
      // @ts-ignore - simulate SSR environment
      delete global.window;

      const hook = new GA4Hook({ enabled: true });

      expect(() => {
        hook.afterEvaluation('my-feature', undefined, true);
      }).not.toThrow();

      expect(() => {
        hook.afterIdentify('user@example.com', undefined);
      }).not.toThrow();

      expect(() => {
        hook.afterRefresh({ 'feature-1': true });
      }).not.toThrow();

      global.window = originalWindow;
    });

    it('should handle checkConsent throwing an error', () => {
      const hook = new GA4Hook({
        checkConsent: () => { throw new Error('Consent error'); }
      });

      expect(() => {
        hook.afterEvaluation('my-feature', undefined, true);
      }).toThrow('Consent error');
    });

    it('should work when gtag becomes available after initialization', () => {
      delete (window as any).gtag;
      const hook = new GA4Hook();

      // No gtag available
      hook.afterEvaluation('feature-1', undefined, true);
      expect(mockGtag).not.toHaveBeenCalled();

      // gtag loaded later
      (window as any).gtag = mockGtag;
      hook.afterEvaluation('feature-2', undefined, true);
      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_evaluated', expect.objectContaining({
        feature_key: 'feature-2',
      }));
    });

    it('should handle empty flags object in afterRefresh', () => {
      const hook = new GA4Hook();

      expect(() => {
        hook.afterRefresh({});
      }).not.toThrow();
    });

    it('should handle rapid flag changes in afterRefresh', () => {
      const hook = new GA4Hook();

      hook.afterRefresh({ 'feature-1': true });
      hook.afterRefresh({ 'feature-1': false });
      hook.afterRefresh({ 'feature-1': true });
      hook.afterRefresh({ 'feature-1': false });

      // First refresh = initialization (0 events)
      // Then 3 changes
      expect(mockGtag).toHaveBeenCalledTimes(3);
    });
  });

  describe('Performance', () => {
    it('should handle rapid successive calls efficiently', () => {
      const hook = new GA4Hook();
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        hook.afterEvaluation(`feature-${i}`, undefined, true);
      }

      const duration = performance.now() - startTime;
      expect(duration).toBeLessThan(100);
      expect(mockGtag).toHaveBeenCalledTimes(1000);
    });

    it('should short-circuit quickly when disabled', () => {
      const hook = new GA4Hook({ enabled: false });
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        hook.afterEvaluation(`feature-${i}`, undefined, true);
      }

      const duration = performance.now() - startTime;
      expect(duration).toBeLessThan(50);
      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should short-circuit quickly when trackAllResults is false and result is false', () => {
      const hook = new GA4Hook({ trackAllResults: false });
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        hook.afterEvaluation(`feature-${i}`, undefined, false);
      }

      const duration = performance.now() - startTime;
      expect(duration).toBeLessThan(50);
      expect(mockGtag).not.toHaveBeenCalled();
    });

    it('should handle large number of flags in afterRefresh', () => {
      const hook = new GA4Hook();
      const flags: Record<string, boolean> = {};

      for (let i = 0; i < 100; i++) {
        flags[`feature-${i}`] = i % 2 === 0;
      }

      const startTime = performance.now();
      hook.afterRefresh(flags);
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(50);
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with full feature flag lifecycle', () => {
      const hook = new GA4Hook({
        measurementId: 'G-TEST123',
        setUserProperties: true,
        debug: false,
      });

      // User identifies
      hook.afterIdentify('user123', undefined);
      expect(mockGtag).toHaveBeenCalledWith('config', 'G-TEST123', {
        user_id: 'user123',
      });

      // Initial flags load
      hook.afterRefresh({ 'feature-a': true, 'feature-b': false });

      // Feature evaluations
      hook.afterEvaluation('feature-a', undefined, true);
      hook.afterEvaluation('feature-b', undefined, false);

      // Real-time update
      hook.afterRefresh({ 'feature-a': false, 'feature-b': true });

      // Verify change events
      expect(mockGtag).toHaveBeenCalledWith('event', 'feature_flag_changed', expect.objectContaining({
        feature_key: 'feature-a',
        old_value: true,
        new_value: false,
      }));
    });

    it('should work with consent management flow', () => {
      let consentGiven = false;
      const hook = new GA4Hook({
        checkConsent: () => consentGiven,
      });

      // No consent - nothing tracked
      hook.afterEvaluation('feature-1', undefined, true);
      hook.afterIdentify('user123', undefined);
      hook.afterRefresh({ 'feature-1': true });
      expect(mockGtag).not.toHaveBeenCalled();

      // User grants consent
      consentGiven = true;

      // Now tracking works
      hook.afterEvaluation('feature-1', undefined, true);
      expect(mockGtag).toHaveBeenCalledTimes(1);

      hook.afterIdentify('user123', undefined);
      expect(mockGtag).toHaveBeenCalledTimes(2);
    });
  });
});
