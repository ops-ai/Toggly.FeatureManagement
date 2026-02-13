/**
 * Configuration options for the AppInsightsHook
 */
export interface AppInsightsHookOptions {
  /**
   * Enable or disable the hook. When disabled, no events are sent to Application Insights.
   * @default true
   */
  enabled?: boolean;

  /**
   * Application Insights instrumentation key or connection string.
   * If not provided, uses the default appInsights instance on window.
   */
  instrumentationKey?: string;

  /**
   * Event name for feature flag evaluations.
   * @default "FeatureFlagEvaluated"
   */
  evaluationEventName?: string;

  /**
   * Event name for feature flag changes (real-time toggles).
   * @default "FeatureFlagChanged"
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
   * Whether to set custom properties for active features on the telemetry context.
   * Creates a property like 'feature_name' = 'enabled' or 'disabled'
   * @default false
   */
  setCustomProperties?: boolean;

  /**
   * Prefix for custom properties.
   * @default "feature_"
   */
  propertyPrefix?: string;

  /**
   * Whether to track feature flag changes from real-time updates.
   * @default true
   */
  trackChanges?: boolean;

  /**
   * Whether to track identity changes.
   * Sets authenticated user context in Application Insights when identity is set.
   * @default true
   */
  trackIdentity?: boolean;

  /**
   * Custom properties to include with every event.
   */
  customProperties?: Record<string, string | number | boolean>;

  /**
   * Custom measurements to include with every event.
   */
  customMeasurements?: Record<string, number>;

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
export type ResolvedAppInsightsHookOptions = Required<Omit<AppInsightsHookOptions, 'instrumentationKey' | 'customProperties' | 'customMeasurements'>> & {
  instrumentationKey?: string;
  customProperties: Record<string, string | number | boolean>;
  customMeasurements: Record<string, number>;
};

/**
 * Application Insights event properties for feature flag evaluation
 */
export interface AppInsightsEvaluationEventProperties {
  feature_key: string;
  feature_enabled: string;
  event_category: string;
  [key: string]: string;
}

/**
 * Application Insights event properties for feature flag change
 */
export interface AppInsightsChangeEventProperties {
  feature_key: string;
  old_value: string;
  new_value: string;
  event_category: string;
  [key: string]: string;
}

/**
 * Application Insights SDK interface (from @microsoft/applicationinsights-web)
 */
export interface IApplicationInsights {
  trackEvent(event: {
    name: string;
    properties?: Record<string, string>;
    measurements?: Record<string, number>;
  }): void;
  setAuthenticatedUserContext(
    authenticatedUserId: string,
    accountId?: string,
    storeInCookie?: boolean
  ): void;
  clearAuthenticatedUserContext(): void;
  context?: {
    user?: {
      authenticatedId?: string;
    };
    telemetryTrace?: {
      traceID?: string;
    };
  };
  addTelemetryInitializer?(
    telemetryInitializer: (item: any) => boolean | void
  ): void;
  config?: {
    instrumentationKey?: string;
    connectionString?: string;
  };
}

/**
 * Type declaration for Application Insights on window
 */
declare global {
  interface Window {
    appInsights?: IApplicationInsights;
  }
}
