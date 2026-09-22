import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import {
  evaluateFeatureGate,
  isFeatureOn,
  onEvaluationsChanged,
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
  isReady: boolean
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
  }, [
    stableKeys,
    keysKey,
    requirement,
    negate,
    defaultValue,
    context,
    contextKind,
  ])

  const [state, setState] = useState({
    evaluate,
    isEnabled: defaultValue,
    isReady: false,
  })
  const lastEvaluation = useRef<typeof evaluate>()
  const refresh = useCallback(() => {
    lastEvaluation.current = evaluate
    setState({ evaluate, isEnabled: evaluate(), isReady: true })
  }, [evaluate])

  useEffect(() => {
    // An abandoned render never sends IPC. StrictMode replay reuses the
    // committed result; explicit refresh and changed inputs evaluate again.
    if (lastEvaluation.current !== evaluate) refresh()
    return onEvaluationsChanged(refresh)
  }, [evaluate, refresh])

  return {
    isEnabled: state.evaluate === evaluate ? state.isEnabled : defaultValue,
    isReady: state.evaluate === evaluate && state.isReady,
    refresh,
  }
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
