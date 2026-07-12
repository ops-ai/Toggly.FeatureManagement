/**
 * Feature requirement type for evaluating multiple features
 */
export type FeatureRequirement = 'all' | 'any'

/**
 * User context for targeting and rollouts
 */
export interface EvaluationContext {
  /** Unique user identifier for stable rollouts */
  identity?: string
  /** Group memberships for group-based targeting */
  groups?: string[]
  /** Custom attributes for advanced targeting rules */
  traits?: Record<string, unknown>
}

/**
 * Main configuration for Toggly Node.js SDK
 */
export interface TogglyConfig {
  /** Toggly application key (required for API mode) */
  appKey?: string
  /** Environment name (default: 'Production') */
  environment?: string
  /** Base URL for Toggly definitions API (default: 'https://definitions.toggly.io') */
  baseUrl?: string
  /** Default identity for all evaluations */
  identity?: string
  /** Default values for features when API unavailable */
  featureDefaults?: Record<string, boolean>
  /** Refresh interval in milliseconds (default: 180000 = 3 min, 0 to disable) */
  refreshInterval?: number
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number
  /** Enable debug logging (default: false) */
  debug?: boolean
  /** Initial hooks to register */
  hooks?: Hook[]
}

/**
 * Extended configuration with server-specific options
 */
export interface TogglyServerConfig extends TogglyConfig {
  /** Enable local file-based caching for offline/startup resilience */
  enableFileCache?: boolean
  /** Path for file cache (default: '.toggly-cache') */
  fileCachePath?: string
  /** Custom cache provider */
  cacheProvider?: CacheProvider
  /** Enable streaming updates via SSE/WebSocket (default: true when appKey is set) */
  enableStreaming?: boolean
  /** Streaming endpoint URL */
  streamingUrl?: string
  /** Use ETag-based polling for efficient updates (default: true) */
  useEtag?: boolean
  /**
   * Verify signed envelopes from evaluated-signed / definitions-signed.
   * Uses exact raw `defs` JSON bytes (never re-serialized).
   */
  verifySignatures?: boolean
  /** Optional allow-list of signing key IDs. Empty / omitted allows all keys. */
  allowedKeyIds?: string[]
  /**
   * Called on refresh / verification failures while last-known-good flags are preserved.
   */
  onError?: (error: Error, context?: string) => void | Promise<void>
}

/**
 * Cache provider interface for custom storage backends
 */
export interface CacheProvider {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttl?: number): Promise<void>
  delete(key: string): Promise<void>
  has(key: string): Promise<boolean>
}

/**
 * Feature definitions from API response
 */
export interface FeatureDefinition {
  featureKey: string
  enabled: boolean
}

/**
 * API response format for feature definitions
 */
export interface FeatureDefinitionsResponse {
  features?: FeatureDefinition[]
  defs?: FeatureDefinitions
  signature?: string
  timestamp?: number
  kid?: string
}

/**
 * Feature definitions map
 */
export type FeatureDefinitions = Record<string, boolean>

/**
 * Client state
 */
export interface TogglyState {
  initialized: boolean
  loading: boolean
  features: FeatureDefinitions
  error: Error | null
  lastRefresh: number | null
  etag: string | null
  wsConnected: boolean
}

/**
 * Feature gate evaluation result
 */
export interface FeatureGateResult {
  allowed: boolean
  featureKeys: string[]
  error?: string
}

/**
 * Hook metadata
 */
export interface HookMetadata {
  name: string
  version?: string
}

/**
 * Data passed between before and after evaluation hooks
 */
export interface EvaluationSeriesData {
  [key: string]: unknown
}

/**
 * Data passed between before and after identify hooks
 */
export interface IdentitySeriesData {
  [key: string]: unknown
}

/**
 * Hook interface for extensibility
 */
export interface Hook {
  getMetadata(): HookMetadata
  beforeEvaluation?(
    flagKey: string,
    context: EvaluationContext,
    defaultValue?: boolean
  ): Promise<EvaluationSeriesData | void>
  afterEvaluation?(
    flagKey: string,
    context: EvaluationContext,
    data: EvaluationSeriesData | void,
    result: boolean
  ): Promise<void>
  beforeIdentify?(identity: string): Promise<IdentitySeriesData | void>
  afterIdentify?(identity: string, data: IdentitySeriesData | void): Promise<void>
  afterRefresh?(features: FeatureDefinitions): Promise<void>
  onError?(error: Error, context?: string): Promise<void>
}

/**
 * Toggly client interface
 */
export interface TogglyClient {
  readonly state: TogglyState
  readonly config: TogglyServerConfig
  identity: string | undefined

  init(config?: TogglyServerConfig): Promise<FeatureDefinitions>
  refresh(): Promise<FeatureDefinitions>
  clearCache(): Promise<void>
  isFeatureOn(featureKey: string, context?: EvaluationContext): Promise<boolean>
  isFeatureOff(featureKey: string, context?: EvaluationContext): Promise<boolean>
  evaluateFeatureGate(
    featureKeys: string[],
    requirement?: FeatureRequirement,
    negate?: boolean,
    context?: EvaluationContext
  ): Promise<boolean>
  setIdentity(identity: string): Promise<void>
  addHook(hook: Hook): void
  removeHook(name: string): boolean
  close(): void
}

/**
 * Request context for middleware (framework-agnostic)
 */
export interface TogglyRequestContext {
  identity?: string
  groups?: string[]
  traits?: Record<string, unknown>
  features?: FeatureDefinitions
}
