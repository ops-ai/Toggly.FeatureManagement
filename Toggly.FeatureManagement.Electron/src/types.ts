import type { TelemetryOptions } from '@ops-ai/toggly-client-telemetry'
import type {
  Hook,
  EvaluatedDefinitions,
  TogglyEntityContext,
} from '@ops-ai/toggly-hooks-types'
import type { VariantResult } from './variant.js'
export type {
  Hook,
  EvaluatedDefinitions,
  TogglyEntityContext,
} from '@ops-ai/toggly-hooks-types'
export type { EvaluatedVariantDef, VariantResult } from './variant.js'

export type FeatureRequirement = 'all' | 'any'

export interface TogglyElectronConfig {
  enableTelemetry?: boolean
  metricsBaseUrl?: string
  telemetryFlushIntervalMs?: number
  telemetryFetch?: TelemetryOptions['fetch']
  onTelemetryDiagnostic?: TelemetryOptions['onDiagnostic']
  appKey?: string
  environment?: string
  baseURI?: string
  flagDefaults?: Record<string, boolean>
  /** Host-minted attribution token; blank clears it. */
  instanceId?: string
  identity?: string
  groups?: string[]
  claims?: Record<string, string>
  verifySignatures?: boolean
  allowedKeyIds?: string[]
  maxSignatureAgeSeconds?: number | null
  enableLiveUpdates?: boolean
  /**
   * Opt-in variant-aware evaluation. Uses `/evaluated-variants-signed` instead
   * of `/evaluated-signed` and enables `getVariant` / `getVariantValue`.
   * Default false.
   */
  enableVariants?: boolean
  /** Required — typically `app.getPath('userData')`. */
  userDataPath: string
  connectTimeout?: number
  featureFlagsRefreshInterval?: number
  isDebug?: boolean
  onError?: (message: string, error?: unknown) => void
  fetch?: typeof fetch
  hooks?: Hook[]
}

export interface SetContextInput {
  /** Host-minted attribution token; blank clears it. */
  instanceId?: string
  identity?: string
  groups?: string[]
  claims?: Record<string, string>
}

export type FeatureFlagsSnapshot = Record<string, boolean>

export type EvaluatedFlags = EvaluatedDefinitions

export type EntityContextInput =
  | TogglyEntityContext
  | Record<string, unknown>
  | null
  | undefined

export interface TogglyTelemetry {
  recordUsage(featureKey: string, variant?: string): void
  recordView(featureKey: string, variant?: string): void
  incrementCounter(metricKey: string, value?: number): void
  setGauge(metricKey: string, value: number): void
  flushTelemetry(): Promise<void>
}

export interface TogglyBridge extends TogglyTelemetry {
  isFeatureOn(
    key: string,
    entityContext?: EntityContextInput,
    kind?: string,
  ): boolean
  isFeatureOff(
    key: string,
    entityContext?: EntityContextInput,
    kind?: string,
  ): boolean
  evaluateFeatureGate(
    keys: string[],
    requirement?: string,
    negate?: boolean,
    entityContext?: EntityContextInput,
    kind?: string,
  ): boolean
  getFlags(): Promise<FeatureFlagsSnapshot>
  setContext(context: SetContextInput): Promise<FeatureFlagsSnapshot>
  clearContext(): Promise<FeatureFlagsSnapshot>
  /**
   * Current variant assignment for a feature (requires `enableVariants`).
   * Null when variants are disabled, the feature is off/local-gated, or no
   * variant is assigned.
   */
  getVariant(key: string): VariantResult | null
  /** Configuration payload for the assigned variant, if any (untyped). */
  getVariantValue<T = unknown>(
    key: string,
    isT?: (value: unknown) => value is T,
  ): T | null
  /** @internal Reactive invalidation, without evaluation or hydration checks. */
  onEvaluationsChanged(callback: () => void): () => void
  onFlagsUpdated(callback: (flags: FeatureFlagsSnapshot) => void): () => void
}

declare global {
  interface Window {
    toggly?: TogglyBridge
  }
}
