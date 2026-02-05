import type { Hook, HookMetadata, EvaluationSeriesData } from '@ops-ai/toggly-hooks-types';
import type { ClarityHookOptions, ResolvedClarityHookOptions } from './types';

/**
 * Microsoft Clarity hook for Toggly Feature Flags SDK.
 *
 * Automatically sends custom events to Microsoft Clarity when feature flags
 * are evaluated as `true`. This enables correlation between feature flag states
 * and user behavior captured in Clarity session recordings and heatmaps.
 *
 * Implements the Toggly `Hook` interface and listens to the `afterEvaluation`
 * lifecycle event.
 *
 * @example
 * ```typescript
 * import { Toggly } from '@ops-ai/feature-flags-toggly';
 * import { ClarityHook } from '@ops-ai/toggly-clarity-hook';
 *
 * Toggly.init({
 *   appKey: 'your-app-key',
 *   environment: 'Production',
 *   hooks: [
 *     new ClarityHook({
 *       eventPrefix: 'FF:',
 *       checkConsent: () => cookieConsent.analytics
 *     })
 *   ]
 * });
 * ```
 */
export class ClarityHook implements Hook {
  private options: ResolvedClarityHookOptions;

  constructor(options: ClarityHookOptions = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      eventPrefix: options.eventPrefix ?? 'FeatureFlag:',
      checkConsent: options.checkConsent ?? (() => true),
    };

    if (this.options.enabled && !this.isClarityAvailable()) {
      console.warn('[Toggly Clarity Hook] Microsoft Clarity not detected. Events will be skipped until Clarity is available.');
    }
  }

  getMetadata(): HookMetadata {
    return { name: 'clarity-hook' };
  }

  afterEvaluation(
    flagKey: string,
    _data: EvaluationSeriesData | void,
    result: boolean
  ): void {
    if (!this.options.enabled) {
      return;
    }

    if (!result) {
      return;
    }

    if (!this.options.checkConsent()) {
      return;
    }

    if (!this.isClarityAvailable()) {
      return;
    }

    try {
      (window as any).clarity('event', `${this.options.eventPrefix}${flagKey}`);
    } catch (error) {
      console.error('[Toggly Clarity Hook] Error sending event:', error);
    }
  }

  /**
   * Check if Microsoft Clarity is available on the page.
   */
  private isClarityAvailable(): boolean {
    return typeof window !== 'undefined' && typeof (window as any).clarity === 'function';
  }
}
