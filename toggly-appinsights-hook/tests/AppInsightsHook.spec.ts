import { AppInsightsHook } from '../src/AppInsightsHook';
import type { IApplicationInsights } from '../src/types';

describe('AppInsightsHook', () => {
  let mockAppInsights: jest.Mocked<IApplicationInsights>;

  const createMockAppInsights = (): jest.Mocked<IApplicationInsights> => ({
    trackEvent: jest.fn(),
    setAuthenticatedUserContext: jest.fn(),
    clearAuthenticatedUserContext: jest.fn(),
    addTelemetryInitializer: jest.fn(),
    context: {
      user: {
        authenticatedId: undefined,
      },
    },
    config: {
      instrumentationKey: 'test-key',
    },
  });

  beforeEach(() => {
    mockAppInsights = createMockAppInsights();
    (global as any).window = {
      appInsights: mockAppInsights,
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete (global as any).window;
  });

  describe('Initialization', () => {
    it('should create hook with default options', () => {
      const hook = new AppInsightsHook();
      expect(hook).toBeDefined();
      expect(hook.getMetadata().name).toBe('appinsights-hook');
    });

    it('should create hook with custom options', () => {
      const hook = new AppInsightsHook({
        enabled: true,
        evaluationEventName: 'CustomEvaluation',
        changeEventName: 'CustomChange',
        trackEvaluations: true,
        trackAllResults: false,
        setCustomProperties: true,
        propertyPrefix: 'ff_',
        trackChanges: false,
        trackIdentity: false,
        debug: true,
      });
      expect(hook).toBeDefined();
    });

    it('should warn if Application Insights is not available', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      (global as any).window = {};

      new AppInsightsHook({ enabled: true });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Application Insights SDK not detected')
      );
      consoleWarnSpy.mockRestore();
    });

    it('should not warn if hook is disabled', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      (global as any).window = {};

      new AppInsightsHook({ enabled: false });

      expect(consoleWarnSpy).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should add telemetry initializer if setCustomProperties is true', () => {
      new AppInsightsHook({ setCustomProperties: true });
      expect(mockAppInsights.addTelemetryInitializer).toHaveBeenCalled();
    });

    it('should not add telemetry initializer if setCustomProperties is false', () => {
      new AppInsightsHook({ setCustomProperties: false });
      expect(mockAppInsights.addTelemetryInitializer).not.toHaveBeenCalled();
    });
  });

  describe('getMetadata', () => {
    it('should return correct hook metadata', () => {
      const hook = new AppInsightsHook();
      const metadata = hook.getMetadata();
      expect(metadata).toEqual({ name: 'appinsights-hook' });
    });
  });

  describe('afterEvaluation', () => {
    it('should track feature evaluation event', () => {
      const hook = new AppInsightsHook();
      hook.afterEvaluation('test-feature', undefined, true);

      expect(mockAppInsights.trackEvent).toHaveBeenCalledWith({
        name: 'FeatureFlagEvaluated',
        properties: {
          feature_key: 'test-feature',
          feature_enabled: 'true',
          event_category: 'toggly',
        },
        measurements: {},
      });
    });

    it('should track evaluation with false result', () => {
      const hook = new AppInsightsHook();
      hook.afterEvaluation('test-feature', undefined, false);

      expect(mockAppInsights.trackEvent).toHaveBeenCalledWith({
        name: 'FeatureFlagEvaluated',
        properties: {
          feature_key: 'test-feature',
          feature_enabled: 'false',
          event_category: 'toggly',
        },
        measurements: {},
      });
    });

    it('should use custom event name', () => {
      const hook = new AppInsightsHook({ evaluationEventName: 'CustomFeatureEvaluated' });
      hook.afterEvaluation('test-feature', undefined, true);

      expect(mockAppInsights.trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'CustomFeatureEvaluated' })
      );
    });

    it('should include custom properties', () => {
      const hook = new AppInsightsHook({
        customProperties: { app_version: '2.0.0', environment: 'production' },
      });
      hook.afterEvaluation('test-feature', undefined, true);

      expect(mockAppInsights.trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            app_version: '2.0.0',
            environment: 'production',
          }),
        })
      );
    });

    it('should include custom measurements', () => {
      const hook = new AppInsightsHook({ customMeasurements: { evaluation_time_ms: 5 } });
      hook.afterEvaluation('test-feature', undefined, true);

      expect(mockAppInsights.trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ measurements: { evaluation_time_ms: 5 } })
      );
    });

    it('should not track when disabled', () => {
      const hook = new AppInsightsHook({ enabled: false });
      hook.afterEvaluation('test-feature', undefined, true);
      expect(mockAppInsights.trackEvent).not.toHaveBeenCalled();
    });

    it('should not track when trackEvaluations is false', () => {
      const hook = new AppInsightsHook({ trackEvaluations: false });
      hook.afterEvaluation('test-feature', undefined, true);
      expect(mockAppInsights.trackEvent).not.toHaveBeenCalled();
    });

    it('should not track false results when trackAllResults is false', () => {
      const hook = new AppInsightsHook({ trackAllResults: false });
      hook.afterEvaluation('test-feature', undefined, false);
      expect(mockAppInsights.trackEvent).not.toHaveBeenCalled();
    });

    it('should track true results when trackAllResults is false', () => {
      const hook = new AppInsightsHook({ trackAllResults: false });
      hook.afterEvaluation('test-feature', undefined, true);
      expect(mockAppInsights.trackEvent).toHaveBeenCalled();
    });

    it('should not track when consent check returns false', () => {
      const hook = new AppInsightsHook({ checkConsent: () => false });
      hook.afterEvaluation('test-feature', undefined, true);
      expect(mockAppInsights.trackEvent).not.toHaveBeenCalled();
    });

    it('should track when consent check returns true', () => {
      const hook = new AppInsightsHook({ checkConsent: () => true });
      hook.afterEvaluation('test-feature', undefined, true);
      expect(mockAppInsights.trackEvent).toHaveBeenCalled();
    });

    it('should not track when Application Insights is not available', () => {
      (global as any).window = {};
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const hook = new AppInsightsHook({ enabled: true });
      hook.afterEvaluation('test-feature', undefined, true);
      expect(mockAppInsights.trackEvent).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should log in debug mode', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const hook = new AppInsightsHook({ debug: true });
      hook.afterEvaluation('test-feature', undefined, true);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Toggly AppInsights Hook] Evaluation tracked:',
        'test-feature',
        true
      );
      consoleLogSpy.mockRestore();
    });

    it('should handle errors gracefully', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockAppInsights.trackEvent.mockImplementation(() => {
        throw new Error('Track event failed');
      });

      const hook = new AppInsightsHook();
      expect(() => hook.afterEvaluation('test-feature', undefined, true)).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Toggly AppInsights Hook] Error sending evaluation event:',
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });

    it('should update feature property when setCustomProperties is true', () => {
      const hook = new AppInsightsHook({ setCustomProperties: true });
      hook.afterEvaluation('test-feature', undefined, true);

      const properties = hook.getFeatureProperties();
      expect(properties['feature_test_feature']).toBe('enabled');
    });

    it('should set disabled property for false evaluation', () => {
      const hook = new AppInsightsHook({ setCustomProperties: true });
      hook.afterEvaluation('test-feature', undefined, false);

      const properties = hook.getFeatureProperties();
      expect(properties['feature_test_feature']).toBe('disabled');
    });
  });

  describe('afterIdentify', () => {
    it('should set authenticated user context', () => {
      const hook = new AppInsightsHook();
      hook.afterIdentify('user@example.com', undefined);

      expect(mockAppInsights.setAuthenticatedUserContext).toHaveBeenCalledWith(
        'user@example.com',
        undefined,
        true
      );
    });

    it('should not set identity when disabled', () => {
      const hook = new AppInsightsHook({ enabled: false });
      hook.afterIdentify('user@example.com', undefined);
      expect(mockAppInsights.setAuthenticatedUserContext).not.toHaveBeenCalled();
    });

    it('should not set identity when trackIdentity is false', () => {
      const hook = new AppInsightsHook({ trackIdentity: false });
      hook.afterIdentify('user@example.com', undefined);
      expect(mockAppInsights.setAuthenticatedUserContext).not.toHaveBeenCalled();
    });

    it('should not set identity when consent check returns false', () => {
      const hook = new AppInsightsHook({ checkConsent: () => false });
      hook.afterIdentify('user@example.com', undefined);
      expect(mockAppInsights.setAuthenticatedUserContext).not.toHaveBeenCalled();
    });

    it('should not set identity when Application Insights is not available', () => {
      (global as any).window = {};
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const hook = new AppInsightsHook({ enabled: true });
      hook.afterIdentify('user@example.com', undefined);
      expect(mockAppInsights.setAuthenticatedUserContext).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should log in debug mode', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const hook = new AppInsightsHook({ debug: true });
      hook.afterIdentify('user@example.com', undefined);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Toggly AppInsights Hook] Identity set:',
        'user@example.com'
      );
      consoleLogSpy.mockRestore();
    });

    it('should handle errors gracefully', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockAppInsights.setAuthenticatedUserContext.mockImplementation(() => {
        throw new Error('Set user failed');
      });

      const hook = new AppInsightsHook();
      expect(() => hook.afterIdentify('user@example.com', undefined)).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Toggly AppInsights Hook] Error setting identity:',
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe('afterRefresh', () => {
    it('should not track changes on first refresh (initialization)', () => {
      const hook = new AppInsightsHook();
      hook.afterRefresh({ feature1: true, feature2: false });

      expect(mockAppInsights.trackEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: 'FeatureFlagChanged' })
      );
    });

    it('should track changes on subsequent refreshes', () => {
      const hook = new AppInsightsHook();
      hook.afterRefresh({ feature1: true });
      hook.afterRefresh({ feature1: false });

      expect(mockAppInsights.trackEvent).toHaveBeenCalledWith({
        name: 'FeatureFlagChanged',
        properties: {
          feature_key: 'feature1',
          old_value: 'true',
          new_value: 'false',
          event_category: 'toggly',
        },
        measurements: {},
      });
    });

    it('should not track when no changes occur', () => {
      const hook = new AppInsightsHook();
      hook.afterRefresh({ feature1: true });
      mockAppInsights.trackEvent.mockClear();
      hook.afterRefresh({ feature1: true });
      expect(mockAppInsights.trackEvent).not.toHaveBeenCalled();
    });

    it('should track multiple changes in single refresh', () => {
      const hook = new AppInsightsHook();
      hook.afterRefresh({ feature1: true, feature2: false });
      mockAppInsights.trackEvent.mockClear();
      hook.afterRefresh({ feature1: false, feature2: true });
      expect(mockAppInsights.trackEvent).toHaveBeenCalledTimes(2);
    });

    it('should use custom event name', () => {
      const hook = new AppInsightsHook({ changeEventName: 'CustomFeatureChanged' });
      hook.afterRefresh({ feature1: true });
      hook.afterRefresh({ feature1: false });

      expect(mockAppInsights.trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'CustomFeatureChanged' })
      );
    });

    it('should include custom properties in change events', () => {
      const hook = new AppInsightsHook({ customProperties: { env: 'test' } });
      hook.afterRefresh({ feature1: true });
      hook.afterRefresh({ feature1: false });

      expect(mockAppInsights.trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({ env: 'test' }),
        })
      );
    });

    it('should not track when disabled', () => {
      const hook = new AppInsightsHook({ enabled: false });
      hook.afterRefresh({ feature1: true });
      hook.afterRefresh({ feature1: false });
      expect(mockAppInsights.trackEvent).not.toHaveBeenCalled();
    });

    it('should not track when trackChanges is false', () => {
      const hook = new AppInsightsHook({ trackChanges: false });
      hook.afterRefresh({ feature1: true });
      hook.afterRefresh({ feature1: false });
      expect(mockAppInsights.trackEvent).not.toHaveBeenCalled();
    });

    it('should not track when consent check returns false', () => {
      const hook = new AppInsightsHook({ checkConsent: () => false });
      hook.afterRefresh({ feature1: true });
      hook.afterRefresh({ feature1: false });
      expect(mockAppInsights.trackEvent).not.toHaveBeenCalled();
    });

    it('should not track when Application Insights is not available', () => {
      (global as any).window = {};
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const hook = new AppInsightsHook({ enabled: true });
      hook.afterRefresh({ feature1: true });
      hook.afterRefresh({ feature1: false });
      expect(mockAppInsights.trackEvent).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should log changes in debug mode', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const hook = new AppInsightsHook({ debug: true });
      hook.afterRefresh({ feature1: true });
      hook.afterRefresh({ feature1: false });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Toggly AppInsights Hook] Feature changed:',
        'feature1',
        true,
        '->',
        false
      );
      consoleLogSpy.mockRestore();
    });

    it('should handle errors gracefully', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const hook = new AppInsightsHook();
      hook.afterRefresh({ feature1: true });

      mockAppInsights.trackEvent.mockImplementation(() => {
        throw new Error('Track failed');
      });

      expect(() => hook.afterRefresh({ feature1: false })).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Toggly AppInsights Hook] Error processing refresh:',
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });

    it('should update feature properties on first refresh when setCustomProperties is true', () => {
      const hook = new AppInsightsHook({ setCustomProperties: true });
      hook.afterRefresh({ feature1: true, feature2: false });

      const properties = hook.getFeatureProperties();
      expect(properties['feature_feature1']).toBe('enabled');
      expect(properties['feature_feature2']).toBe('disabled');
    });

    it('should update feature properties on subsequent refresh when setCustomProperties is true', () => {
      const hook = new AppInsightsHook({ setCustomProperties: true });
      hook.afterRefresh({ feature1: true });
      hook.afterRefresh({ feature1: false });

      const properties = hook.getFeatureProperties();
      expect(properties['feature_feature1']).toBe('disabled');
    });

    it('should only track changes for flags that existed before', () => {
      const hook = new AppInsightsHook();
      hook.afterRefresh({ feature1: true });
      mockAppInsights.trackEvent.mockClear();
      hook.afterRefresh({ feature1: true, feature2: false });
      expect(mockAppInsights.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe('Property sanitization', () => {
    it('should sanitize property names with special characters', () => {
      const hook = new AppInsightsHook({ setCustomProperties: true });
      hook.afterEvaluation('my-feature/test.v2', undefined, true);

      const properties = hook.getFeatureProperties();
      expect(properties['feature_my_feature_test_v2']).toBe('enabled');
    });

    it('should truncate long property names', () => {
      const hook = new AppInsightsHook({ setCustomProperties: true });
      const longName = 'a'.repeat(200);
      hook.afterEvaluation(longName, undefined, true);

      const properties = hook.getFeatureProperties();
      const keys = Object.keys(properties);
      expect(keys[0].length).toBeLessThanOrEqual(150);
    });

    it('should use custom property prefix', () => {
      const hook = new AppInsightsHook({
        setCustomProperties: true,
        propertyPrefix: 'ff_',
      });
      hook.afterEvaluation('test-feature', undefined, true);

      const properties = hook.getFeatureProperties();
      expect(properties['ff_test_feature']).toBe('enabled');
    });
  });

  describe('getFeatureProperties', () => {
    it('should return copy of feature properties', () => {
      const hook = new AppInsightsHook({ setCustomProperties: true });
      hook.afterEvaluation('feature1', undefined, true);

      const properties = hook.getFeatureProperties();
      properties['feature_feature1'] = 'modified';

      expect(hook.getFeatureProperties()['feature_feature1']).toBe('enabled');
    });

    it('should return empty object when no properties set', () => {
      const hook = new AppInsightsHook({ setCustomProperties: false });
      const properties = hook.getFeatureProperties();
      expect(properties).toEqual({});
    });
  });

  describe('clearFeatureProperties', () => {
    it('should clear all feature properties', () => {
      const hook = new AppInsightsHook({ setCustomProperties: true });
      hook.afterEvaluation('feature1', undefined, true);
      hook.afterEvaluation('feature2', undefined, false);
      hook.clearFeatureProperties();
      expect(hook.getFeatureProperties()).toEqual({});
    });
  });

  describe('Telemetry initializer', () => {
    it('should add properties to telemetry items', () => {
      const hook = new AppInsightsHook({ setCustomProperties: true });
      const initializer = (mockAppInsights.addTelemetryInitializer as jest.Mock).mock.calls[0][0];

      hook.afterEvaluation('test-feature', undefined, true);

      const telemetryItem = { data: {} as Record<string, string> };
      const result = initializer(telemetryItem);

      expect(result).toBe(true);
      expect(telemetryItem.data).toHaveProperty('feature_test_feature', 'enabled');
    });

    it('should handle telemetry items without data', () => {
      const hook = new AppInsightsHook({ setCustomProperties: true });
      const initializer = (mockAppInsights.addTelemetryInitializer as jest.Mock).mock.calls[0][0];

      hook.afterEvaluation('test-feature', undefined, true);

      const telemetryItem = {};
      const result = initializer(telemetryItem);

      expect(result).toBe(true);
    });

    it('should not add telemetry initializer multiple times', () => {
      const hook = new AppInsightsHook({ setCustomProperties: true });
      hook.afterRefresh({ feature1: true });
      expect(mockAppInsights.addTelemetryInitializer).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined window', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      (global as any).window = undefined;

      const hook = new AppInsightsHook({ enabled: true });
      expect(() => hook.afterEvaluation('test', undefined, true)).not.toThrow();
      expect(() => hook.afterIdentify('user', undefined)).not.toThrow();
      expect(() => hook.afterRefresh({ test: true })).not.toThrow();
      consoleWarnSpy.mockRestore();
    });

    it('should handle missing addTelemetryInitializer method', () => {
      const appInsightsNoInit = {
        trackEvent: jest.fn(),
        setAuthenticatedUserContext: jest.fn(),
        clearAuthenticatedUserContext: jest.fn(),
        context: {},
        config: {},
      };
      (global as any).window = { appInsights: appInsightsNoInit };

      expect(() => new AppInsightsHook({ setCustomProperties: true })).not.toThrow();
    });

    it('should handle empty flags object in afterRefresh', () => {
      const hook = new AppInsightsHook();
      expect(() => hook.afterRefresh({})).not.toThrow();
    });

    it('should handle data parameter in afterEvaluation', () => {
      const hook = new AppInsightsHook();
      const data = { flagKey: 'test', context: { userId: '123' } };

      expect(() => hook.afterEvaluation('test', data, true)).not.toThrow();
      expect(mockAppInsights.trackEvent).toHaveBeenCalled();
    });

    it('should handle data parameter in afterIdentify', () => {
      const hook = new AppInsightsHook();
      const data = { identity: 'user@test.com', attributes: { name: 'Test User' } };

      expect(() => hook.afterIdentify('user@test.com', data)).not.toThrow();
      expect(mockAppInsights.setAuthenticatedUserContext).toHaveBeenCalled();
    });

    it('should stringify boolean and number custom properties', () => {
      const hook = new AppInsightsHook({
        customProperties: {
          is_premium: true,
          user_count: 42,
          name: 'test',
        },
      });

      hook.afterEvaluation('feature', undefined, true);

      expect(mockAppInsights.trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            is_premium: 'true',
            user_count: '42',
            name: 'test',
          }),
        })
      );
    });

    it('should handle appInsights becoming available after initialization', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      (global as any).window = {};

      const hook = new AppInsightsHook({ enabled: true });

      (global as any).window.appInsights = mockAppInsights;

      hook.afterEvaluation('test-feature', undefined, true);
      expect(mockAppInsights.trackEvent).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should handle window without appInsights defined', () => {
      (global as any).window = { someOtherProp: true };
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const hook = new AppInsightsHook({ enabled: true });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Application Insights SDK not detected')
      );

      hook.afterEvaluation('test', undefined, true);
      hook.afterIdentify('user', undefined);
      hook.afterRefresh({ feature: true });

      consoleWarnSpy.mockRestore();
    });

    it('should not add telemetry initializer when appInsights has no addTelemetryInitializer method during refresh', () => {
      const appInsightsNoInit = {
        trackEvent: jest.fn(),
        setAuthenticatedUserContext: jest.fn(),
        clearAuthenticatedUserContext: jest.fn(),
        context: {},
        config: {},
      };
      (global as any).window = { appInsights: appInsightsNoInit };

      const hook = new AppInsightsHook({ setCustomProperties: true });
      hook.afterRefresh({ feature1: true });

      const properties = hook.getFeatureProperties();
      expect(properties['feature_feature1']).toBe('enabled');
    });
  });

  describe('Performance', () => {
    it('should handle rapid consecutive evaluations', () => {
      const hook = new AppInsightsHook();

      for (let i = 0; i < 1000; i++) {
        hook.afterEvaluation(`feature-${i}`, undefined, i % 2 === 0);
      }

      expect(mockAppInsights.trackEvent).toHaveBeenCalledTimes(1000);
    });

    it('should handle rapid consecutive refreshes', () => {
      const hook = new AppInsightsHook();
      hook.afterRefresh({ feature1: true });

      for (let i = 0; i < 100; i++) {
        hook.afterRefresh({ feature1: i % 2 === 0 });
      }

      // First refresh is initialization (feature1: true), then loop starts at i=0 (true) = no change,
      // i=1 (false) = change, i=2 (true) = change, etc. So 99 changes total.
      expect(mockAppInsights.trackEvent).toHaveBeenCalledTimes(99);
    });
  });
});
