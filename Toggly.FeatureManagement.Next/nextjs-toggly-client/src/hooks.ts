'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { FeatureRequirement } from '@ops-ai/nextjs-toggly-core'
import type { TogglyEntityContext } from '@ops-ai/nextjs-toggly-core'
import { useToggly } from './context'
import type { UseFeatureFlagReturn } from './types'

export interface UseFeatureFlagOptions {
  context?: TogglyEntityContext | Record<string, unknown> | null
  contextKind?: string
}

/**
 * Hook to check if a feature is enabled
 *
 * @example
 * ```tsx
 * 'use client'
 * import { useFeatureFlag } from '@ops-ai/nextjs-toggly-client'
 *
 * export function MyComponent() {
 *   const { isEnabled, isLoading } = useFeatureFlag('new-dashboard')
 *
 *   if (isLoading) return <LoadingSpinner />
 *
 *   return isEnabled ? <NewDashboard /> : <OldDashboard />
 * }
 * ```
 */
export function useFeatureFlag(
  featureKey: string,
  options: UseFeatureFlagOptions = {},
): UseFeatureFlagReturn {
  const { context, contextKind } = options
  const { features, isReady, isLoading: contextLoading, isFeatureOn, refresh: contextRefresh } = useToggly()
  const request = useRef(0)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => {active.current = false; request.current++} }, [])
  const [checked, setChecked] = useState(false)
  const [isEnabled, setIsEnabled] = useState(() => features[featureKey] === true)

  useEffect(() => {
    setChecked(false)
  }, [featureKey, context, contextKind])

  const checkFeature = useCallback(async () => {
    const current = ++request.current
    if (!isReady && !Object.prototype.hasOwnProperty.call(features, featureKey)) {
      setIsEnabled(false)
      return
    }

    try {
      const result = await isFeatureOn(featureKey, context, contextKind)
      if (!active.current || current !== request.current) return
      setIsEnabled(result)
      setChecked(true)
    } catch {
      if (!active.current || current !== request.current) return
      setIsEnabled(false)
      setChecked(true)
    }
  }, [featureKey, features, isReady, isFeatureOn, context, contextKind])

  // Check feature when ready changes
  useEffect(() => {
    void checkFeature()
    return () => { request.current++ }
  }, [checkFeature])

  const refresh = useCallback(async () => {
    await contextRefresh()
  }, [contextRefresh])

  const isLoading = contextLoading || (isReady && !checked)

  return useMemo(
    () => ({
      isEnabled,
      isDisabled: !isEnabled,
      isLoading,
      refresh,
    }),
    [isEnabled, isLoading, refresh]
  )
}

/**
 * Hook to check if a feature is disabled
 * Convenience wrapper with inverted logic
 */
export function useFeatureOff(
  featureKey: string,
  options: UseFeatureFlagOptions = {},
): UseFeatureFlagReturn {
  const result = useFeatureFlag(featureKey, options)

  return useMemo(
    () => ({
      isEnabled: result.isDisabled,
      isDisabled: result.isEnabled,
      isLoading: result.isLoading,
      refresh: result.refresh,
    }),
    [result]
  )
}

/**
 * Hook to evaluate a feature gate with multiple features
 *
 * @example
 * ```tsx
 * 'use client'
 * import { useFeatureGate } from '@ops-ai/nextjs-toggly-client'
 *
 * export function AdminPanel() {
 *   const { isAllowed, isLoading } = useFeatureGate(
 *     ['admin-feature', 'beta-access'],
 *     'all'
 *   )
 *
 *   if (isLoading) return <LoadingSpinner />
 *   if (!isAllowed) return <AccessDenied />
 *
 *   return <AdminContent />
 * }
 * ```
 */
export function useFeatureGate(
  featureKeys: string[],
  requirement: FeatureRequirement = 'all',
  negate: boolean = false,
  context?: TogglyEntityContext | Record<string, unknown> | null,
  contextKind?: string,
): {
  isAllowed: boolean
  isBlocked: boolean
  isLoading: boolean
  refresh: () => Promise<void>
} {
  const keySignature = JSON.stringify(featureKeys)
  const keys = useMemo(() => JSON.parse(keySignature) as string[], [keySignature])
  const { features, isReady, isLoading: contextLoading, evaluateFeatureGate } = useToggly()
  const request = useRef(0)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => {active.current = false; request.current++} }, [])
  const [checked, setChecked] = useState(false)
  const [isAllowed, setIsAllowed] = useState(() => {
    if (requirement === 'any') {
      const result = keys.some((key) => features[key] === true)
      return negate ? !result : result
    }
    const result = keys.every((key) => features[key] === true)
    return negate ? !result : result
  })

  const checkGate = useCallback(async () => {
    const current = ++request.current
    if (!isReady && !keys.every(key => Object.prototype.hasOwnProperty.call(features, key))) {
      // An unresolved loading snapshot does not evaluate flags.
      let result: boolean
      if (requirement === 'any') {
        result = keys.some((key) => features[key] === true)
      } else {
        result = keys.every((key) => features[key] === true)
      }
      setIsAllowed(negate ? !result : result)
      return
    }

    try {
      const result = await evaluateFeatureGate(
        keys,
        requirement,
        negate,
        context,
        contextKind,
      )
      if (!active.current || current !== request.current) return
      setIsAllowed(result)
      setChecked(true)
    } catch {
      if (!active.current || current !== request.current) return
      setIsAllowed(negate)
      setChecked(true)
    }
  }, [keys, features, isReady, evaluateFeatureGate, requirement, negate, context, contextKind])

  useEffect(() => {
    void checkGate()
    return () => { request.current++ }
  }, [checkGate])

  const refresh = useCallback(async () => {
    await checkGate()
  }, [checkGate])

  const isLoading = contextLoading || (isReady && !checked)

  return useMemo(
    () => ({
      isAllowed,
      isBlocked: !isAllowed,
      isLoading,
      refresh,
    }),
    [isAllowed, isLoading, refresh]
  )
}

/**
 * Hook to get all feature flags
 *
 * @example
 * ```tsx
 * 'use client'
 * import { useFeatures } from '@ops-ai/nextjs-toggly-client'
 *
 * export function FeatureDebug() {
 *   const { features, isLoading } = useFeatures()
 *
 *   return (
 *     <pre>{JSON.stringify(features, null, 2)}</pre>
 *   )
 * }
 * ```
 */
export function useFeatures(): {
  features: Record<string, boolean>
  isLoading: boolean
  isReady: boolean
  refresh: () => Promise<void>
} {
  const { features, isLoading, isReady, refresh } = useToggly()

  return useMemo(
    () => ({
      features,
      isLoading,
      isReady,
      refresh,
    }),
    [features, isLoading, isReady, refresh]
  )
}

/**
 * Hook to manage user identity
 *
 * @example
 * ```tsx
 * 'use client'
 * import { useIdentity } from '@ops-ai/nextjs-toggly-client'
 *
 * export function UserProfile() {
 *   const { identity, setIdentity, isUpdating } = useIdentity()
 *
 *   const handleLogin = async (userId: string) => {
 *     await setIdentity(userId)
 *   }
 *
 *   return (
 *     <div>Current user: {identity}</div>
 *   )
 * }
 * ```
 */
export function useIdentity(): {
  identity: string | undefined
  setIdentity: (identity: string) => Promise<void>
  setContext: (context: {
    instanceId?: string
    identity?: string
    groups?: string[]
    claims?: Record<string, string>
  }) => Promise<void>
  isUpdating: boolean
} {
  const {
    identity,
    setIdentity: setContextIdentity,
    setContext: setContextValue,
  } = useToggly()
  const [isUpdating, setIsUpdating] = useState(false)

  const setIdentity = useCallback(
    async (newIdentity: string) => {
      setIsUpdating(true)
      try {
        await setContextIdentity(newIdentity)
      } finally {
        setIsUpdating(false)
      }
    },
    [setContextIdentity]
  )

  const setContext = useCallback(
    async (contextUpdate: {
      instanceId?: string
      identity?: string
      groups?: string[]
      claims?: Record<string, string>
    }) => {
      setIsUpdating(true)
      try {
        await setContextValue(contextUpdate)
      } finally {
        setIsUpdating(false)
      }
    },
    [setContextValue],
  )

  return useMemo(
    () => ({
      identity,
      setIdentity,
      setContext,
      isUpdating,
    }),
    [identity, setIdentity, setContext, isUpdating]
  )
}
