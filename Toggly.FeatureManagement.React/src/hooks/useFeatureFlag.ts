import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
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
  const { negate = false } = options
  return useFeatureGate(featureKey ? [featureKey] : [], { requirement: 'all', negate })
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
  const [isEnabled, setIsEnabled] = useState(defaultValue)
  const [isLoading, setIsLoading] = useState(true)
  const keysKey = useMemo(() => featureKeys.join('\0'), [featureKeys])
  const stableKeys = useMemo(() => [...featureKeys], [keysKey])

  const evaluate = useCallback(async () => {
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
      setIsEnabled(result)
    } catch {
      setIsEnabled(defaultValue)
    } finally {
      setIsLoading(false)
    }
  }, [toggly, stableKeys, keysKey, requirement, negate, defaultValue, context, contextKind])

  useEffect(() => {
    void evaluate()
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
