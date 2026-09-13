import type { Hook } from '@ops-ai/toggly-hooks-types'
import type { EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types'

export type FeatureRequirement = 'all' | 'any'

export interface TogglyElectronConfig {
  appKey?: string
  environment?: string
  baseURI?: string
  flagDefaults?: Record<string, boolean>
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
  identity?: string
  groups?: string[]
  claims?: Record<string, string>
}

export type FeatureFlagsSnapshot = Record<string, boolean>

export type EvaluatedFlags = EvaluatedDefinitions

export type EntityContextInput = TogglyEntityContext | Record<string, unknown> | null | undefined

export interface TogglyBridge {
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
  onFlagsUpdated(callback: (flags: FeatureFlagsSnapshot) => void): () => void
}

declare global {
  interface Window {
    toggly?: TogglyBridge
  }
}

export type { Hook, EvaluatedDefinitions, TogglyEntityContext }
