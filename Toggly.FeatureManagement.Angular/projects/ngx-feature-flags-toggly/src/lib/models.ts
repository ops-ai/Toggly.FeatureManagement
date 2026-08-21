import type { Hook, TogglyEntityContext, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import { appendEvaluationContext, evaluationContextCacheKey } from '@ops-ai/toggly-hooks-types';
import type { LocalGate } from '@ops-ai/toggly-local-gates';

/** Assigned variant for a feature (from evaluated-variants-signed). */
export interface VariantResult {
  name: string
  configurationValue?: unknown
}

/** Raw evaluated variant entry from the definitions API. */
export interface EvaluatedVariantDef {
  enabled: boolean
  variant?: string
  configurationValue?: unknown
}

export interface ITogglyOptions {
  baseURI?: string
  appKey?: string
  environment?: string
  identity?: string
  groups?: string[]
  claims?: Record<string, string>
  featureDefaults?: { [key: string]: boolean }
  showFeatureDuringEvaluation?: boolean
  customDefinitionsUrl?: string
  /** Whether signatures should be verified on signed responses */
  verifySignatures?: boolean
  /**
   * When verifySignatures is enabled, only accept signatures from these key IDs.
   * Omit / empty = any kid present in JWKS is accepted.
   */
  allowedKeyIds?: string[]
  /**
   * Reject signed envelopes older than this many seconds when verifySignatures is enabled.
   * Omit / null / <=0 = disabled (back-compat).
   */
  maxSignatureAgeSeconds?: number | null
  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[]
  /** Enable localStorage caching of definitions. Default: true. Set false for SSR-only or privacy-sensitive contexts. */
  persistCache?: boolean
  /** Max identity-scoped cache keys (flags/variants). null/omit = unlimited. */
  maxCacheKeys?: number | null
  /**
   * When true, fetches from evaluated-variants-signed and exposes variant APIs.
   * Default: false.
   */
  enableVariants?: boolean
  /** Device-local gates applied as a read-time AND on worker-evaluated booleans */
  localGates?: LocalGate[]
  /** Optional SDK error callback for reporting fetch/cache/evaluation failures. */
  onError?: (message: string, error?: unknown) => void
}

export interface ITogglyService {
  shouldShowFeatureDuringEvaluation: boolean
  evaluateFeatureGate: (
    featureKeys: string[],
    requirement?: string,
    negate?: boolean,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => Promise<boolean>
  isFeatureOn: (
    featureKey: string,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => Promise<boolean>
  isFeatureOff: (featureKey: string) => Promise<boolean>
  getVariant: (featureKey: string) => Promise<VariantResult | null>
  getVariantValue: (featureKey: string) => Promise<unknown | null>
  addHook: (hook: Hook) => void
  removeHook: (name: string) => boolean
  setLocalGates: (gates: LocalGate[]) => void
  notifyLocalGatesChanged: () => void
  subscribeLocalGatesChanged: (listener: () => void) => () => void
  subscribeFeaturesRefresh: (listener: () => void) => () => void
  setContext: (context: TogglyEvaluationContext) => Promise<void>
  registerContext: <T>(kind: string, mapper: (entity: T) => TogglyEntityContext) => void
}
