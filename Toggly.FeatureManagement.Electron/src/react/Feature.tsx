import React, { useEffect, useMemo, useState, type ReactNode } from 'react'
import { evaluateFeatureGate, onFlagsUpdated } from '../renderer/index.js'
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

  const [shouldShow, setShouldShow] = useState<boolean | null>(null)

  useEffect(() => {
    const evaluate = () => {
      if (gate.length === 0) {
        setShouldShow(!negate)
        return
      }
      try {
        setShouldShow(
          evaluateFeatureGate(gate, requirement, negate, context, contextKind),
        )
      } catch {
        setShouldShow(false)
      }
    }

    evaluate()
    return onFlagsUpdated(() => evaluate())
  }, [gate.join(','), requirement, negate, context, contextKind])

  if (shouldShow === null) {
    return loading ? <>{loading}</> : null
  }

  return shouldShow ? <>{children}</> : null
}

export default Feature
