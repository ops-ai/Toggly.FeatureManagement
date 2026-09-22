import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { context } from '../contexts'
import type { TogglyService } from '../services'

export interface UseFeatureFlagOptions {
  defaultValue?: boolean
  negate?: boolean
  context?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null
  contextKind?: string
}

export interface UseFeatureFlagResult {
  isEnabled: boolean
  isLoading: boolean
  refresh: () => Promise<void>
}

export interface UseFeatureGateOptions extends UseFeatureFlagOptions {
  requirement?: string
}

function useTogglyService(): TogglyService | undefined {
  return useContext(context).toggly
}

/**
 * Hook to check if a single feature flag is enabled.
 */
export function useFeatureFlag(
  featureKey: string,
  options: UseFeatureFlagOptions = {},
): UseFeatureFlagResult {
  return useFeatureGate(featureKey ? [featureKey] : [], { ...options, requirement: 'all' })
}

/**
 * Hook to evaluate multiple feature keys as a gate.
 */
export function useFeatureGate(
  featureKeys: string[],
  options: UseFeatureGateOptions = {},
): UseFeatureFlagResult {
  const { requirement = 'all', negate = false, defaultValue = false, context, contextKind } = options
  const toggly = useTogglyService()
  const evaluation = useRef(0)
  const [isEnabled, setIsEnabled] = useState(defaultValue)
  const [isLoading, setIsLoading] = useState(true)
  const keysKey = useMemo(() => featureKeys.join('\0'), [featureKeys])
  const stableKeys = useMemo(() => [...featureKeys], [keysKey])

  const evaluate = useCallback(async () => {
    const current = ++evaluation.current
    if (!toggly) {
      setIsEnabled(defaultValue)
      setIsLoading(false)
      return
    }

    if (stableKeys.length === 0) {
      setIsEnabled(!negate)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const result = await toggly.evaluateFeatureGate(stableKeys, requirement, negate, context, contextKind)
      if (current === evaluation.current) setIsEnabled(result)
    } catch {
      if (current === evaluation.current) setIsEnabled(defaultValue)
    } finally {
      if (current === evaluation.current) setIsLoading(false)
    }
  }, [toggly, stableKeys, keysKey, requirement, negate, defaultValue, context, contextKind])

  useEffect(() => {
    void evaluate()
    return () => { evaluation.current++ }
  }, [evaluate])

  useEffect(() => {
    if (!toggly || stableKeys.length === 0) {
      return
    }

    const unsubRefresh = toggly.subscribeFeaturesRefresh(() => {
      void evaluate()
    })
    const unsubLocalGates = toggly.subscribeLocalGatesChanged(() => {
      void evaluate()
    })

    return () => {
      unsubRefresh()
      unsubLocalGates()
    }
  }, [toggly, keysKey, evaluate, stableKeys.length])

  const refresh = useCallback(async () => {
    await evaluate()
  }, [evaluate])

  return { isEnabled, isLoading, refresh }
}
