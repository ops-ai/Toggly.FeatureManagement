import type { Hook, HookMetadata, EvaluationSeriesData, IdentitySeriesData } from '@ops-ai/toggly-hooks-types';
import type {
  AppInsightsHookOptions,
  ResolvedAppInsightsHookOptions,
  AppInsightsEvaluationEventProperties,
  AppInsightsChangeEventProperties,
  IApplicationInsights,
} from './types';

/**
 * Azure Application Insights hook for Toggly Feature Flags SDK.
 *
 * Automatically sends feature flag events to Application Insights when feature flags
 * are evaluated or changed. This enables correlation between feature flag states
 * and application performance, errors, and user behavior in Azure Monitor.
 *
 * Implements the Toggly `Hook` interface and listens to `afterEvaluation`,
 * `afterIdentify`, and `afterRefresh` lifecycle events.
 *
 * @example
 * ```typescript
 * import { Toggly } from '@ops-ai/feature-flags-toggly';
 * import { AppInsightsHook } from '@ops-ai/toggly-appinsights-hook';
 *
 * Toggly.init({
 *   appKey: 'your-app-key',
 *   environment: 'Production',
 *   hooks: [
 *     new AppInsightsHook({
 *       trackEvaluations: true,
 *       trackChanges: true,
 *       setCustomProperties: true,
 *       checkConsent: () => cookieConsent.analytics
 *     })
 *   ]
 * });
 * ```
 */
export class AppInsightsHook implements Hook {
  private options: ResolvedAppInsightsHookOptions;
  private previousFlags: Record<string, boolean> = {};
  private initialized = false;
  private telemetryInitializerAdded = false;
  private currentFeatureProperties: Record<string, string> = {};

  constructor(options: AppInsightsHookOptions = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      instrumentationKey: options.instrumentationKey,
      evaluationEventName: options.evaluationEventName ?? 'FeatureFlagEvaluated',
      changeEventName: options.changeEventName ?? 'FeatureFlagChanged',
      trackEvaluations: options.trackEvaluations ?? true,
      trackAllResults: options.trackAllResults ?? true,
      setCustomProperties: options.setCustomProperties ?? false,
      propertyPrefix: options.propertyPrefix ?? 'feature_',
      trackChanges: options.trackChanges ?? true,
      trackIdentity: options.trackIdentity ?? true,
      customProperties: options.customProperties ?? {},
      customMeasurements: options.customMeasurements ?? {},
      checkConsent: options.checkConsent ?? (() => true),
      debug: options.debug ?? false,
    };

    if (this.options.enabled && !this.isAppInsightsAvailable()) {
      console.warn('[Toggly AppInsights Hook] Application Insights SDK not detected. Events will be skipped until it is available.');
    }

    // Add telemetry initializer if custom properties are enabled
    if (this.options.enabled && this.options.setCustomProperties && this.isAppInsightsAvailable()) {
      this.addTelemetryInitializer();
    }
  }

  getMetadata(): HookMetadata {
    return { name: 'appinsights-hook' };
  }

  /**
   * Called after feature flag evaluation.
   * Sends an event to Application Insights with the feature key and result.
   */
  afterEvaluation(
    flagKey: string,
    _data: EvaluationSeriesData | void,
    result: boolean
  ): void {
    if (!this.options.enabled) {
      return;
    }

    if (!this.options.trackEvaluations) {
      return;
    }

    if (!this.options.trackAllResults && !result) {
      return;
    }

    if (!this.options.checkConsent()) {
      return;
    }

    if (!this.isAppInsightsAvailable()) {
      return;
    }

    try {
      const properties: AppInsightsEvaluationEventProperties = {
        feature_key: flagKey,
        feature_enabled: String(result),
        event_category: 'toggly',
        ...this.stringifyCustomProperties(this.options.customProperties),
      };

      this.trackEvent(this.options.evaluationEventName, properties);

      if (this.options.setCustomProperties) {
        this.updateFeatureProperty(flagKey, result);
      }

      if (this.options.debug) {
        console.log('[Toggly AppInsights Hook] Evaluation tracked:', flagKey, result);
      }
    } catch (error) {
      console.error('[Toggly AppInsights Hook] Error sending evaluation event:', error);
    }
  }

  /**
   * Called after identity is set or changed.
   * Sets the authenticated user context in Application Insights.
   */
  afterIdentify(
    identity: string,
    _data: IdentitySeriesData | void
  ): void {
    if (!this.options.enabled) {
      return;
    }

    if (!this.options.trackIdentity) {
      return;
    }

    if (!this.options.checkConsent()) {
      return;
    }

    if (!this.isAppInsightsAvailable()) {
      return;
    }

    try {
      const appInsights = this.getAppInsights();
      if (appInsights) {
        appInsights.setAuthenticatedUserContext(identity, undefined, true);
      }

      if (this.options.debug) {
        console.log('[Toggly AppInsights Hook] Identity set:', identity);
      }
    } catch (error) {
      console.error('[Toggly AppInsights Hook] Error setting identity:', error);
    }
  }

  /**
   * Called when feature flags are refreshed from the server.
   * Tracks any changes in feature flag states and optionally sends change events.
   */
  afterRefresh(flags: { [key: string]: boolean }): void {
    if (!this.options.enabled) {
      return;
    }

    if (!this.options.trackChanges) {
      return;
    }

    if (!this.options.checkConsent()) {
      return;
    }

    if (!this.isAppInsightsAvailable()) {
      return;
    }

    try {
      // Only track changes after initial load
      if (this.initialized) {
        for (const [flagKey, newValue] of Object.entries(flags)) {
          const oldValue = this.previousFlags[flagKey];
          if (oldValue !== undefined && oldValue !== newValue) {
            const properties: AppInsightsChangeEventProperties = {
              feature_key: flagKey,
              old_value: String(oldValue),
              new_value: String(newValue),
              event_category: 'toggly',
              ...this.stringifyCustomProperties(this.options.customProperties),
            };

            this.trackEvent(this.options.changeEventName, properties);

            if (this.options.setCustomProperties) {
              this.updateFeatureProperty(flagKey, newValue);
            }

            if (this.options.debug) {
              console.log('[Toggly AppInsights Hook] Feature changed:', flagKey, oldValue, '->', newValue);
            }
          }
        }
      } else {
        // First refresh - set initial custom properties if enabled
        if (this.options.setCustomProperties) {
          for (const [flagKey, value] of Object.entries(flags)) {
            this.updateFeatureProperty(flagKey, value);
          }
          // Ensure telemetry initializer is added
          if (!this.telemetryInitializerAdded) {
            this.addTelemetryInitializer();
          }
        }
        this.initialized = true;
      }

      // Store current state for next comparison
      this.previousFlags = { ...flags };
    } catch (error) {
      console.error('[Toggly AppInsights Hook] Error processing refresh:', error);
    }
  }

  /**
   * Track an event in Application Insights.
   */
  private trackEvent(eventName: string, properties: Record<string, string>): void {
    const appInsights = this.getAppInsights();
    if (appInsights) {
      appInsights.trackEvent({
        name: eventName,
        properties,
        measurements: this.options.customMeasurements,
      });
    }
  }

  /**
   * Update a feature property for telemetry context.
   */
  private updateFeatureProperty(flagKey: string, value: boolean): void {
    const propertyName = `${this.options.propertyPrefix}${this.sanitizePropertyName(flagKey)}`;
    const propertyValue = value ? 'enabled' : 'disabled';
    this.currentFeatureProperties[propertyName] = propertyValue;
  }

  /**
   * Add telemetry initializer to attach feature flags to all telemetry items.
   */
  private addTelemetryInitializer(): void {
    const appInsights = this.getAppInsights();
    if (appInsights && appInsights.addTelemetryInitializer && !this.telemetryInitializerAdded) {
      appInsights.addTelemetryInitializer((item: any) => {
        // Add feature flag properties to all telemetry
        if (item && item.data) {
          item.data = item.data || {};
          for (const [key, value] of Object.entries(this.currentFeatureProperties)) {
            item.data[key] = value;
          }
        }
        return true; // Continue processing the telemetry item
      });
      this.telemetryInitializerAdded = true;
    }
  }

  /**
   * Sanitize a flag key for use as an Application Insights property name.
   * Property names should be alphanumeric with underscores, max 150 chars.
   */
  private sanitizePropertyName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .substring(0, 150 - this.options.propertyPrefix.length);
  }

  /**
   * Convert custom properties to string values for Application Insights.
   */
  private stringifyCustomProperties(props: Record<string, string | number | boolean>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(props)) {
      result[key] = String(value);
    }
    return result;
  }

  /**
   * Check if Application Insights SDK is available on the page.
   */
  private isAppInsightsAvailable(): boolean {
    return typeof window !== 'undefined' && window.appInsights !== undefined;
  }

  /**
   * Get the Application Insights instance.
   */
  private getAppInsights(): IApplicationInsights | undefined {
    if (typeof window !== 'undefined') {
      return window.appInsights;
    }
    return undefined;
  }

  /**
   * Get current feature properties (useful for debugging).
   */
  public getFeatureProperties(): Record<string, string> {
    return { ...this.currentFeatureProperties };
  }

  /**
   * Clear all feature properties.
   */
  public clearFeatureProperties(): void {
    this.currentFeatureProperties = {};
  }
}
