import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  evaluateFeatureGate,
  isFeatureOn,
  onFlagsUpdated,
} from '../renderer/index.js'
import type { EntityContextInput, FeatureRequirement } from '../types.js'

export interface UseFeatureFlagOptions {
  defaultValue?: boolean
  negate?: boolean
  context?: EntityContextInput
  contextKind?: string
}

export interface UseFeatureFlagResult {
  isEnabled: boolean
  refresh: () => void
}

export interface UseFeatureGateOptions extends UseFeatureFlagOptions {
  requirement?: FeatureRequirement | string
}

export function useFeatureFlag(
  featureKey: string,
  options: UseFeatureFlagOptions = {},
): UseFeatureFlagResult {
  const { negate = false, defaultValue = false, context, contextKind } = options
  return useFeatureGate(featureKey ? [featureKey] : [], {
    requirement: 'all',
    negate,
    defaultValue,
    context,
    contextKind,
  })
}

export function useFeatureGate(
  featureKeys: string[],
  options: UseFeatureGateOptions = {},
): UseFeatureFlagResult {
  const {
    requirement = 'all',
    negate = false,
    defaultValue = false,
    context,
    contextKind,
  } = options
  const keysKey = useMemo(() => featureKeys.join('\0'), [featureKeys])
  const stableKeys = useMemo(() => [...featureKeys], [keysKey])

  const evaluate = useCallback((): boolean => {
    if (stableKeys.length === 0) {
      return !negate
    }
    try {
      return evaluateFeatureGate(
        stableKeys,
        requirement,
        negate,
        context,
        contextKind,
      )
    } catch {
      return defaultValue
    }
  }, [stableKeys, keysKey, requirement, negate, defaultValue, context, contextKind])

  const [isEnabled, setIsEnabled] = useState<boolean>(() => {
    try {
      return evaluate()
    } catch {
      return defaultValue
    }
  })

  const refresh = useCallback(() => {
    setIsEnabled(evaluate())
  }, [evaluate])

  useEffect(() => {
    refresh()
    return onFlagsUpdated(() => {
      refresh()
    })
  }, [refresh])

  return { isEnabled, refresh }
}

/** Sync helper for non-hook callers. */
export function readFeatureFlag(
  featureKey: string,
  options: UseFeatureFlagOptions = {},
): boolean {
  const { negate = false, defaultValue = false, context, contextKind } = options
  try {
    if (negate) {
      return !isFeatureOn(featureKey, context, contextKind)
    }
    return isFeatureOn(featureKey, context, contextKind)
  } catch {
    return defaultValue
  }
}
