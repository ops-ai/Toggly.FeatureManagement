import type { TogglyConfig, TogglyClient, FeatureRequirement } from '@ops-ai/nuxt-toggly-core'
import type { ComputedRef, Ref, InjectionKey } from 'vue'

/**
 * Client-side Toggly configuration
 */
export interface TogglyClientConfig extends TogglyConfig {
  /** Whether to persist identity to localStorage (default: true) */
  persistIdentity?: boolean
  /** LocalStorage key for identity (default: 'toggly:identity') */
  identityStorageKey?: string
  /** Whether to persist features to localStorage for offline support (default: false) */
  persistFeatures?: boolean
  /** LocalStorage key for features (default: 'toggly:features') */
  featuresStorageKey?: string
}

/**
 * Return type for useToggly composable
 */
export interface UseTogglyReturn {
  /** The Toggly client instance */
  client: TogglyClient
  /** Whether the client is ready/initialized */
  isReady: Ref<boolean>
  /** Whether features are currently loading */
  isLoading: Ref<boolean>
  /** Current error (if any) */
  error: Ref<Error | null>
  /** Current feature definitions */
  features: Ref<Record<string, boolean>>
  /** Current user identity */
  identity: Ref<string | undefined>
  /** Initialize the client */
  init: (config?: TogglyConfig) => Promise<void>
  /** Refresh feature definitions */
  refresh: () => Promise<void>
  /** Set user identity */
  setIdentity: (identity: string) => Promise<void>
  /** Check if a feature is enabled */
  isFeatureOn: (featureKey: string) => Promise<boolean>
  /** Check if a feature is disabled */
  isFeatureOff: (featureKey: string) => Promise<boolean>
  /** Evaluate a feature gate */
  evaluateFeatureGate: (
    featureKeys: string[],
    requirement?: FeatureRequirement,
    negate?: boolean
  ) => Promise<boolean>
}

/**
 * Return type for useFeatureFlag composable
 */
export interface UseFeatureFlagReturn {
  /** Whether the feature is enabled */
  isEnabled: ComputedRef<boolean>
  /** Whether the feature is disabled */
  isDisabled: ComputedRef<boolean>
  /** Whether the feature state is loading */
  isLoading: Ref<boolean>
  /** Refresh the feature state */
  refresh: () => Promise<void>
}

/**
 * Return type for useFeatureGate composable
 */
export interface UseFeatureGateReturn {
  /** Whether the gate passes */
  isEnabled: ComputedRef<boolean>
  /** Whether the gate fails */
  isDisabled: ComputedRef<boolean>
  /** Whether the gate is loading */
  isLoading: Ref<boolean>
  /** Refresh the gate */
  refresh: () => Promise<void>
}

/**
 * Feature component props
 */
export interface FeatureProps {
  /** Single feature key to check */
  featureKey?: string
  /** Multiple feature keys to check */
  featureKeys?: string[]
  /** Requirement type for multiple features */
  requirement?: FeatureRequirement
  /** Negate the result */
  negate?: boolean
}

/**
 * Toggly injection key
 */
export const TOGGLY_INJECTION_KEY: InjectionKey<UseTogglyReturn> = Symbol('toggly')
