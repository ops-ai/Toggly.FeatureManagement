import type { Hook, HookMetadata, EvaluationSeriesData, IdentitySeriesData } from '@ops-ai/toggly-hooks-types';
import type { GA4HookOptions, ResolvedGA4HookOptions, GA4EvaluationEventParams, GA4ChangeEventParams } from './types';

/**
 * Google Analytics 4 hook for Toggly Feature Flags SDK.
 *
 * Automatically sends feature flag events to Google Analytics 4 when feature flags
 * are evaluated or changed. This enables correlation between feature flag states
 * and user behavior metrics in GA4.
 *
 * Implements the Toggly `Hook` interface and listens to `afterEvaluation`,
 * `afterIdentify`, and `afterRefresh` lifecycle events.
 *
 * @example
 * ```typescript
 * import { Toggly } from '@ops-ai/feature-flags-toggly';
 * import { GA4Hook } from '@ops-ai/toggly-ga4-hook';
 *
 * Toggly.init({
 *   appKey: 'your-app-key',
 *   environment: 'Production',
 *   hooks: [
 *     new GA4Hook({
 *       measurementId: 'G-XXXXXXXXXX',
 *       trackEvaluations: true,
 *       trackChanges: true,
 *       setUserProperties: true,
 *       checkConsent: () => cookieConsent.analytics
 *     })
 *   ]
 * });
 * ```
 */
export class GA4Hook implements Hook {
  private options: ResolvedGA4HookOptions;
  private previousFlags: Record<string, boolean> = {};
  private initialized = false;

  constructor(options: GA4HookOptions = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      measurementId: options.measurementId,
      evaluationEventName: options.evaluationEventName ?? 'feature_flag_evaluated',
      changeEventName: options.changeEventName ?? 'feature_flag_changed',
      trackEvaluations: options.trackEvaluations ?? true,
      trackAllResults: options.trackAllResults ?? true,
      setUserProperties: options.setUserProperties ?? false,
      userPropertyPrefix: options.userPropertyPrefix ?? 'ff_',
      trackChanges: options.trackChanges ?? true,
      trackIdentity: options.trackIdentity ?? true,
      customParameters: options.customParameters ?? {},
      checkConsent: options.checkConsent ?? (() => true),
      debug: options.debug ?? false,
    };

    if (this.options.enabled && !this.isGtagAvailable()) {
      console.warn('[Toggly GA4 Hook] Google Analytics 4 gtag not detected. Events will be skipped until gtag is available.');
    }
  }

  getMetadata(): HookMetadata {
    return { name: 'ga4-hook' };
  }

  /**
   * Called after feature flag evaluation.
   * Sends an event to GA4 with the feature key and result.
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

    if (!this.isGtagAvailable()) {
      return;
    }

    try {
      const eventParams: GA4EvaluationEventParams = {
        feature_key: flagKey,
        feature_enabled: result,
        event_category: 'toggly',
        ...this.options.customParameters,
      };

      this.sendEvent(this.options.evaluationEventName, eventParams);

      if (this.options.setUserProperties) {
        this.setUserProperty(flagKey, result);
      }

      if (this.options.debug) {
        console.log('[Toggly GA4 Hook] Evaluation tracked:', flagKey, result);
      }
    } catch (error) {
      console.error('[Toggly GA4 Hook] Error sending evaluation event:', error);
    }
  }

  /**
   * Called after identity is set or changed.
   * Sets the user_id in GA4 for user-scoped analytics.
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

    if (!this.isGtagAvailable()) {
      return;
    }

    try {
      const measurementId = this.options.measurementId;
      if (measurementId) {
        window.gtag!('config', measurementId, {
          user_id: identity,
        });
      } else {
        // Set user_id globally if no specific measurement ID
        window.gtag!('set', 'user_properties', {
          user_id: identity,
        });
      }

      if (this.options.debug) {
        console.log('[Toggly GA4 Hook] Identity set:', identity);
      }
    } catch (error) {
      console.error('[Toggly GA4 Hook] Error setting identity:', error);
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

    if (!this.isGtagAvailable()) {
      return;
    }

    try {
      // Only track changes after initial load
      if (this.initialized) {
        for (const [flagKey, newValue] of Object.entries(flags)) {
          const oldValue = this.previousFlags[flagKey];
          if (oldValue !== undefined && oldValue !== newValue) {
            const eventParams: GA4ChangeEventParams = {
              feature_key: flagKey,
              old_value: oldValue,
              new_value: newValue,
              event_category: 'toggly',
              ...this.options.customParameters,
            };

            this.sendEvent(this.options.changeEventName, eventParams);

            if (this.options.setUserProperties) {
              this.setUserProperty(flagKey, newValue);
            }

            if (this.options.debug) {
              console.log('[Toggly GA4 Hook] Feature changed:', flagKey, oldValue, '->', newValue);
            }
          }
        }
      } else {
        // First refresh - set initial user properties if enabled
        if (this.options.setUserProperties) {
          for (const [flagKey, value] of Object.entries(flags)) {
            this.setUserProperty(flagKey, value);
          }
        }
        this.initialized = true;
      }

      // Store current state for next comparison
      this.previousFlags = { ...flags };
    } catch (error) {
      console.error('[Toggly GA4 Hook] Error processing refresh:', error);
    }
  }

  /**
   * Send an event to GA4.
   */
  private sendEvent(eventName: string, params: Record<string, any>): void {
    if (this.options.measurementId) {
      window.gtag!('event', eventName, {
        send_to: this.options.measurementId,
        ...params,
      });
    } else {
      window.gtag!('event', eventName, params);
    }
  }

  /**
   * Set a user property in GA4.
   */
  private setUserProperty(flagKey: string, value: boolean): void {
    const propertyName = `${this.options.userPropertyPrefix}${this.sanitizePropertyName(flagKey)}`;
    const propertyValue = value ? 'on' : 'off';

    window.gtag!('set', 'user_properties', {
      [propertyName]: propertyValue,
    });
  }

  /**
   * Sanitize a flag key for use as a GA4 user property name.
   * GA4 user property names must be alphanumeric with underscores, max 24 chars.
   */
  private sanitizePropertyName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .substring(0, 24 - this.options.userPropertyPrefix.length);
  }

  /**
   * Check if Google Analytics gtag is available on the page.
   */
  private isGtagAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.gtag === 'function';
  }
}
