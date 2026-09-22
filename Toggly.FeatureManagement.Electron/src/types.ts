import type { TelemetryOptions } from '@ops-ai/toggly-client-telemetry'
import type {
  Hook,
  EvaluatedDefinitions,
  TogglyEntityContext,
} from '@ops-ai/toggly-hooks-types'

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
    requirement?: FeatureRequirement | string,
    negate?: boolean,
    entityContext?: EntityContextInput,
    kind?: string,
  ): boolean
  getFlags(): Promise<FeatureFlagsSnapshot>
  setContext(context: SetContextInput): Promise<FeatureFlagsSnapshot>
  clearContext(): Promise<FeatureFlagsSnapshot>
  /** @internal Reactive invalidation, without evaluation or hydration checks. */
  onEvaluationsChanged(callback: () => void): () => void
  onFlagsUpdated(callback: (flags: FeatureFlagsSnapshot) => void): () => void
}

declare global {
  interface Window {
    toggly?: TogglyBridge
  }
}

export type { Hook, EvaluatedDefinitions, TogglyEntityContext }
