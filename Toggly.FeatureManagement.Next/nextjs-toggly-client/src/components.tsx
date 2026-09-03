'use client'

import type { ReactNode } from 'react'
import type { FeatureRequirement } from '@ops-ai/nextjs-toggly-core'
import { useFeatureFlag, useFeatureGate } from './hooks'
import type { FeatureProps } from './types'

/**
 * Client Component for feature flag rendering.
 * Use `negate` to render when the feature is off (same as .NET `<feature negate>`).
 */
export function Feature({
  featureKey,
  requirement = 'all',
  negate = false,
  children,
  loading = null,
}: FeatureProps): ReactNode {
  const featureKeys = Array.isArray(featureKey) ? featureKey : [featureKey]
  const { isAllowed, isLoading } = useFeatureGate(
    featureKeys,
    requirement,
    negate
  )

  if (isLoading) {
    return loading
  }

  return isAllowed ? children : null
}

/**
 * Client Component for A/B testing / variant rendering
 */
export function FeatureVariant({
  featureKey,
  enabled,
  disabled,
  loading = null,
}: {
  featureKey: string
  enabled: ReactNode
  disabled: ReactNode
  loading?: ReactNode
}): ReactNode {
  const { isEnabled, isLoading } = useFeatureFlag(featureKey)

  if (isLoading) {
    return loading
  }

  return isEnabled ? enabled : disabled
}

/**
 * Client Component for feature gate with multiple features.
 * Use `negate` to render when the gate fails.
 */
export function FeatureGate({
  featureKeys,
  requirement = 'all',
  negate = false,
  children,
  loading = null,
}: {
  featureKeys: string[]
  requirement?: FeatureRequirement
  negate?: boolean
  children: ReactNode
  loading?: ReactNode
}): ReactNode {
  const { isAllowed, isLoading } = useFeatureGate(
    featureKeys,
    requirement,
    negate
  )

  if (isLoading) {
    return loading
  }

  return isAllowed ? children : null
}

/**
 * Client Component that renders different content based on feature state
 */
export function FeatureSwitch({
  featureKey,
  cases,
}: {
  featureKey: string
  cases: {
    on: ReactNode
    off: ReactNode
    loading?: ReactNode
  }
}): ReactNode {
  const { isEnabled, isLoading } = useFeatureFlag(featureKey)

  if (isLoading) {
    return cases.loading ?? null
  }

  return isEnabled ? cases.on : cases.off
}
