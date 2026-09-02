import type { EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'

export type { EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types'
export type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'

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
  /** Principal / JWT-style claims for UserClaims filters */
  claims?: Record<string, string>
  /** HTTP request fields for segment identity filters */
  request?: {
    userAgent?: string
    acceptLanguage?: string
    country?: string
  }
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
   * Verify signed envelopes from definitions-signed.
   * Uses exact raw `defs` JSON bytes (never re-serialized).
   */
  verifySignatures?: boolean
  /** Optional allow-list of signing key IDs. Empty / omitted allows all keys. */
  allowedKeyIds?: string[]
  /**
   * Reject signed envelopes older than this many seconds when verifySignatures is enabled.
   * Omit / null / <=0 = disabled (back-compat).
   */
  maxSignatureAgeSeconds?: number | null
  /**
   * Called on refresh / verification failures while last-known-good flags are preserved.
   */
  onError?: (error: Error, context?: string) => void | Promise<void>
  /** Register entity context schemas with Toggly on startup (default: true) */
  registerContextsOnStartup?: boolean
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
 * Legacy evaluated feature entry (boolean snapshot shape).
 * @deprecated Prefer FeatureDefinitionModel from `@ops-ai/toggly-eval`.
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
  defs?: FeatureDefinitionModel[] | FeatureDefinitions
  signature?: string
  timestamp?: number
  kid?: string
}

/**
 * Feature definitions map (boolean snapshot per flag for hooks / defaults)
 */
export type FeatureDefinitions = EvaluatedDefinitions

/**
 * Client state
 */
export interface TogglyState {
  initialized: boolean
  loading: boolean
  /** Snapshot evaluated with config identity (for afterRefresh hooks / inspection). */
  features: FeatureDefinitions
  /** Raw definitions-signed rules used for call-site local evaluation. */
  definitions: Map<string, FeatureDefinitionModel>
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
  isFeatureOn(
    featureKey: string,
    context?: EvaluationContext,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean>
  isFeatureOff(
    featureKey: string,
    context?: EvaluationContext,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean>
  evaluateFeatureGate(
    featureKeys: string[],
    requirement?: FeatureRequirement,
    negate?: boolean,
    context?: EvaluationContext,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean>
  registerContext<T>(
    kind: string,
    mapper: (entity: T) => TogglyEntityContext,
    schema?: {
      keyProperty: string
      displayName?: string
      properties: Array<{ name: string; type: string }>
    },
  ): void
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
