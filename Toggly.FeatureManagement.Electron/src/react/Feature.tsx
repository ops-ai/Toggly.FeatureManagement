import React, { useMemo, type ReactNode } from 'react'
import { useFeatureGate } from './useFeatureFlag.js'
import type { EntityContextInput, FeatureRequirement } from '../types.js'

export interface FeatureProps {
  featureKey?: string
  featureKeys?: string[]
  requirement?: FeatureRequirement | string
  negate?: boolean
  context?: EntityContextInput
  contextKind?: string
  children?: ReactNode
  /** Content while evaluating (optional). */
  loading?: ReactNode
}

/**
 * Conditionally render children based on feature flags (Flutter-like DX).
 */
export function Feature({
  featureKey,
  featureKeys = [],
  requirement = 'all',
  negate = false,
  context,
  contextKind,
  children,
  loading = null,
}: FeatureProps): React.ReactElement | null {
  const gate = useMemo(() => {
    if (featureKey) {
      return [featureKey, ...featureKeys]
    }
    return [...featureKeys]
  }, [featureKey, featureKeys])

  const { isEnabled: shouldShow, isReady } = useFeatureGate(gate, {
    requirement,
    negate,
    context,
    contextKind,
  })

  if (!isReady) {
    return loading ? <>{loading}</> : null
  }

  return shouldShow ? <>{children}</> : null
}

export default Feature
