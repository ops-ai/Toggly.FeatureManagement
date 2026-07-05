/**
 * Configuration options for Toggly
 */
import type { LocalGate } from '@ops-ai/toggly-local-gates'

export type { LocalGate }

export interface TogglyConfig {
  /** Your Toggly application key */
  appKey?: string
  /** Environment name (default: 'Production') */
  environment?: string
  /** Base URI for the Toggly API (default: 'https://definitions.toggly.io') */
  baseUri?: string
  /** User identity for targeting and rollouts */
  identity?: string
  /** User groups for targeting */
  groups?: string[]
  /** Custom claims for targeting */
  claims?: Record<string, string>
  /** Default feature flag values when API is unavailable */
  featureDefaults?: Record<string, boolean>
  /** Show content while evaluating features (default: false) */
  showFeatureDuringEvaluation?: boolean
  /** Refresh interval in milliseconds (0 to disable, default: 180000 - 3 minutes) */
  refreshInterval?: number
  /** Initial hooks to register */
  hooks?: Hook[]
  /** Enable WebSocket live updates for real-time flag changes (browser only, default: false) */
  enableLiveUpdates?: boolean
  /** Device-local gates applied as a read-time AND on worker-evaluated booleans */
  localGates?: LocalGate[]
  /** Optional SDK error callback for reporting fetch/evaluation failures. */
  onError?: (message: string, error?: unknown) => void
}

/**
 * Feature requirement for multiple feature evaluation
 */
export type FeatureRequirement = 'all' | 'any'

/**
 * Feature gate configuration
 */
export interface FeatureGate {
  /** Feature key(s) to check */
  featureKeys: string | string[]
  /** Requirement type for multiple features */
  requirement?: FeatureRequirement
  /** Negate the result */
  negate?: boolean
}

/**
 * Data passed between before/after evaluation hooks
 */
export interface EvaluationSeriesData {
  [key: string]: unknown
}

/**
 * Data passed between before/after identify hooks
 */
export interface IdentitySeriesData {
  [key: string]: unknown
}

/**
 * Hook interface for extending Toggly behavior
 */
export interface Hook {
  /** Returns hook metadata */
  getMetadata(): HookMetadata

  /** Called before feature evaluation */
  beforeEvaluation?(
    flagKey: string,
    defaultValue?: boolean
  ): Promise<EvaluationSeriesData | void>

  /** Called after feature evaluation */
  afterEvaluation?(
    flagKey: string,
    data: EvaluationSeriesData | void,
    result: boolean
  ): Promise<void>

  /** Called before identity is set */
  beforeIdentify?(identity: string): Promise<IdentitySeriesData | void>

  /** Called after identity is set */
  afterIdentify?(
    identity: string,
    data: IdentitySeriesData | void
  ): Promise<void>

  /** Called after feature flags are refreshed */
  afterRefresh?(flags: Record<string, boolean>): Promise<void>
}

/**
 * Hook metadata
 */
export interface HookMetadata {
  /** Unique name for the hook */
  name: string
}

/**
 * Feature definitions fetched from API
 */
export interface FeatureDefinitions {
  /** Map of feature keys to their enabled state */
  [featureKey: string]: boolean
}

/**
 * API response for feature definitions
 */
export interface FeatureDefinitionsResponse {
  features?: Array<{
    featureKey: string
    enabled: boolean
  }>
  defs?: FeatureDefinitions
}

/**
 * Evaluation result with metadata
 */
export interface EvaluationResult {
  /** Whether the feature is enabled */
  enabled: boolean
  /** The feature key that was evaluated */
  featureKey: string
  /** Source of the evaluation (api, cache, default) */
  source: 'api' | 'cache' | 'default'
  /** Timestamp of evaluation */
  evaluatedAt: Date
}

/**
 * Client state
 */
export interface TogglyState {
  /** Whether the client has been initialized */
  initialized: boolean
  /** Whether features are currently loading */
  loading: boolean
  /** Current feature definitions */
  features: FeatureDefinitions
  /** Last error (if any) */
  error: Error | null
  /** Last refresh timestamp */
  lastRefresh: Date | null
  /** Whether WebSocket is currently connected */
  wsConnected: boolean
}

/**
 * Toggly client interface
 */
export interface TogglyClient {
  /** Current state */
  readonly state: TogglyState
  /** Current configuration */
  readonly config: TogglyConfig
  /** Current identity */
  identity: string | undefined

  /** Initialize the client */
  init(config?: TogglyConfig): Promise<FeatureDefinitions>

  /** Refresh feature definitions from API */
  refresh(): Promise<FeatureDefinitions>

  /** Check if a single feature is enabled */
  isFeatureOn(featureKey: string): Promise<boolean>

  /** Check if a single feature is disabled */
  isFeatureOff(featureKey: string): Promise<boolean>

  /** Evaluate a feature gate with multiple features */
  evaluateFeatureGate(
    featureKeys: string[],
    requirement?: FeatureRequirement,
    negate?: boolean
  ): Promise<boolean>

  /** Set user identity */
  setIdentity(identity: string): Promise<void>

  /** Add a hook */
  addHook(hook: Hook): void

  /** Remove a hook by name */
  removeHook(name: string): boolean

  /** Register device-local post-filter gates */
  setLocalGates(gates: LocalGate[]): void

  /** Notify subscribers that local gate state changed (no network) */
  notifyLocalGatesChanged(): void

  /** Subscribe to local gate changes */
  subscribeLocalGatesChanged(listener: () => void): () => void

  /** Subscribe to feature refreshes */
  subscribeFeaturesRefresh(listener: () => void): () => void

  /** Destroy the client and cleanup */
  destroy(): void
}
