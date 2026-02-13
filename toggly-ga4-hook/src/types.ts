/**
 * Configuration options for the GA4Hook
 */
export interface GA4HookOptions {
  /**
   * Enable or disable the hook. When disabled, no events are sent to GA4.
   * @default true
   */
  enabled?: boolean;

  /**
   * GA4 Measurement ID (e.g., 'G-XXXXXXXXXX').
   * If not provided, uses the default gtag instance.
   */
  measurementId?: string;

  /**
   * Event name for feature flag evaluations.
   * @default "feature_flag_evaluated"
   */
  evaluationEventName?: string;

  /**
   * Event name for feature flag changes (real-time toggles).
   * @default "feature_flag_changed"
   */
  changeEventName?: string;

  /**
   * Whether to track feature flag evaluations.
   * @default true
   */
  trackEvaluations?: boolean;

  /**
   * Whether to track both true and false results.
   * When false, only tracks evaluations that return true.
   * @default true
   */
  trackAllResults?: boolean;

  /**
   * Whether to set user properties for active features.
   * Creates a user property like 'ff_feature_name' = 'on' or 'off'
   * @default false
   */
  setUserProperties?: boolean;

  /**
   * Prefix for user properties.
   * @default "ff_"
   */
  userPropertyPrefix?: string;

  /**
   * Whether to track feature flag changes from real-time updates.
   * @default true
   */
  trackChanges?: boolean;

  /**
   * Whether to track identity changes.
   * Sends user_id to GA4 when identity is set.
   * @default true
   */
  trackIdentity?: boolean;

  /**
   * Custom parameters to include with every event.
   */
  customParameters?: Record<string, string | number | boolean>;

  /**
   * Callback to check user consent before sending events.
   * Called before each event is sent. Return `true` to allow, `false` to block.
   * Useful for GDPR/CCPA compliance with consent management platforms.
   * @default () => true
   */
  checkConsent?: () => boolean;

  /**
   * Enable debug mode for verbose console logging.
   * @default false
   */
  debug?: boolean;
}

/**
 * Resolved configuration with all defaults applied
 */
export type ResolvedGA4HookOptions = Required<Omit<GA4HookOptions, 'measurementId' | 'customParameters'>> & {
  measurementId?: string;
  customParameters: Record<string, string | number | boolean>;
};

/**
 * GA4 event parameters for feature flag evaluation
 */
export interface GA4EvaluationEventParams {
  feature_key: string;
  feature_enabled: boolean;
  event_category: string;
  [key: string]: string | number | boolean;
}

/**
 * GA4 event parameters for feature flag change
 */
export interface GA4ChangeEventParams {
  feature_key: string;
  old_value: boolean;
  new_value: boolean;
  event_category: string;
  [key: string]: string | number | boolean;
}

/**
 * Gtag function type
 */
export type GtagFunction = (
  command: 'config' | 'event' | 'set' | 'js',
  targetIdOrEventName: string | Date,
  configOrEventParams?: Record<string, any>
) => void;

/**
 * Type declaration for gtag function
 */
declare global {
  interface Window {
    gtag?: GtagFunction;
    dataLayer?: any[];
  }
}
