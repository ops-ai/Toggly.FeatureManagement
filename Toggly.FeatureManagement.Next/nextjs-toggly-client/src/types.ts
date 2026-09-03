import type { TogglyConfig, TogglyClient, FeatureRequirement } from '@ops-ai/nextjs-toggly-core'
import type { ReactNode } from 'react'

/**
 * Client-side Toggly configuration
 */
export interface TogglyClientConfig extends TogglyConfig {
  /** Persist identity to localStorage (default: true) */
  persistIdentity?: boolean
  /** Storage key for identity (default: 'toggly:identity') */
  identityStorageKey?: string
  /** Persist features to localStorage (default: false) */
  persistFeatures?: boolean
  /** Storage key for features (default: 'toggly:features') */
  featuresStorageKey?: string
}

/**
 * Toggly context value
 */
export interface TogglyContextValue {
  /** Toggly client instance */
  client: TogglyClient
  /** Whether the client is ready */
  isReady: boolean
  /** Whether the client is loading */
  isLoading: boolean
  /** Current error (if any) */
  error: Error | null
  /** Current feature definitions */
  features: Record<string, boolean>
  /** Current identity */
  identity: string | undefined
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
 * Props for TogglyProvider
 */
export interface TogglyProviderProps {
  /** Toggly configuration */
  config: TogglyClientConfig
  /** Initial feature definitions (from SSR) */
  initialFeatures?: Record<string, boolean>
  /** Whether to auto-initialize (default: true) */
  autoInit?: boolean
  /** Children components */
  children: ReactNode
}

/**
 * Return type for useFeatureFlag hook
 */
export interface UseFeatureFlagReturn {
  /** Whether the feature is enabled */
  isEnabled: boolean
  /** Whether the feature is disabled */
  isDisabled: boolean
  /** Whether the feature is loading */
  isLoading: boolean
  /** Refresh the feature state */
  refresh: () => Promise<void>
}

/**
 * Props for Feature component
 */
export interface FeatureProps {
  /** Feature key(s) to check */
  featureKey: string | string[]
  /** Requirement for multiple features */
  requirement?: FeatureRequirement
  /** When true, render children when the feature is off */
  negate?: boolean
  /** Content to render when the gate passes */
  children: ReactNode
  /** Content to render while loading */
  loading?: ReactNode
}

/**
 * Injection key for context
 */
export const TOGGLY_CONTEXT_KEY = Symbol('toggly')
