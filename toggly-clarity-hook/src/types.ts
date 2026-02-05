/**
 * Configuration options for the ClarityHook
 */
export interface ClarityHookOptions {
  /**
   * Enable or disable the hook. When disabled, no events are sent to Clarity.
   * @default true
   */
  enabled?: boolean;

  /**
   * Prefix for Clarity custom event names.
   * Events are sent as: `clarity("event", "{eventPrefix}{flagKey}")`
   * @default "FeatureFlag:"
   */
  eventPrefix?: string;

  /**
   * Callback to check user consent before sending events.
   * Called before each event is sent. Return `true` to allow, `false` to block.
   * Useful for GDPR/CCPA compliance with consent management platforms.
   * @default () => true
   */
  checkConsent?: () => boolean;
}

/**
 * Resolved configuration with all defaults applied
 */
export type ResolvedClarityHookOptions = Required<ClarityHookOptions>;
