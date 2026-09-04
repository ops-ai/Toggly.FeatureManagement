'use client'

import type { ReactNode } from 'react'
import type { FeatureRequirement } from '@ops-ai/nextjs-toggly-core'
import { useFeatureFlag, useFeatureGate } from './hooks'
import type { FeatureProps } from './types'
import type { TogglyEntityContext } from '@ops-ai/nextjs-toggly-core'

/**
 * Client Component for feature flag rendering.
 * Use `negate` to render when the feature is off (same as .NET `<feature negate>`).
 */
export function Feature({
  featureKey,
  requirement = 'all',
  negate = false,
  context,
  contextKind,
  children,
  loading = null,
}: FeatureProps): ReactNode {
  const featureKeys = Array.isArray(featureKey) ? featureKey : [featureKey]
  const { isAllowed, isLoading } = useFeatureGate(
    featureKeys,
    requirement,
    negate,
    context,
    contextKind,
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
  context,
  contextKind,
}: {
  featureKey: string
  enabled: ReactNode
  disabled: ReactNode
  loading?: ReactNode
  context?: TogglyEntityContext | Record<string, unknown> | null
  contextKind?: string
}): ReactNode {
  const { isEnabled, isLoading } = useFeatureFlag(featureKey, { context, contextKind })

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
  context,
  contextKind,
  children,
  loading = null,
}: {
  featureKeys: string[]
  requirement?: FeatureRequirement
  negate?: boolean
  context?: TogglyEntityContext | Record<string, unknown> | null
  contextKind?: string
  children: ReactNode
  loading?: ReactNode
}): ReactNode {
  const { isAllowed, isLoading } = useFeatureGate(
    featureKeys,
    requirement,
    negate,
    context,
    contextKind,
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
  context,
  contextKind,
}: {
  featureKey: string
  cases: {
    on: ReactNode
    off: ReactNode
    loading?: ReactNode
  }
  context?: TogglyEntityContext | Record<string, unknown> | null
  contextKind?: string
}): ReactNode {
  const { isEnabled, isLoading } = useFeatureFlag(featureKey, { context, contextKind })

  if (isLoading) {
    return cases.loading ?? null
  }

  return isEnabled ? cases.on : cases.off
}
