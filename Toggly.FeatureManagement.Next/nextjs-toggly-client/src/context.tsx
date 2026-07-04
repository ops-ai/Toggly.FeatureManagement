'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import {
  createTogglyClient,
  type TogglyClient,
  type TogglyConfig,
  type FeatureRequirement,
} from '@ops-ai/nextjs-toggly-core'
import type {
  TogglyContextValue,
  TogglyClientConfig,
  TogglyProviderProps,
} from './types'

// Create context with undefined default
const TogglyContext = createContext<TogglyContextValue | undefined>(undefined)

/**
 * TogglyProvider component
 *
 * @example
 * ```tsx
 * // In app/providers.tsx
 * 'use client'
 * import { TogglyProvider } from '@ops-ai/nextjs-toggly-client'
 *
 * export function Providers({ children }: { children: React.ReactNode }) {
 *   return (
 *     <TogglyProvider
 *       config={{
 *         appKey: process.env.NEXT_PUBLIC_TOGGLY_APP_KEY!,
 *         environment: 'Production',
 *       }}
 *     >
 *       {children}
 *     </TogglyProvider>
 *   )
 * }
 * ```
 */
export function TogglyProvider({
  config,
  initialFeatures,
  autoInit = true,
  children,
}: TogglyProviderProps): ReactNode {
  const [client] = useState<TogglyClient>(() => {
    const mergedConfig: TogglyClientConfig = {
      persistIdentity: true,
      identityStorageKey: 'toggly:identity',
      persistFeatures: false,
      featuresStorageKey: 'toggly:features',
      ...config,
      featureDefaults: {
        ...initialFeatures,
        ...config.featureDefaults,
      },
    }

    // Load persisted identity if available
    if (
      mergedConfig.persistIdentity &&
      typeof window !== 'undefined' &&
      !mergedConfig.identity
    ) {
      const persistedIdentity = localStorage.getItem(
        mergedConfig.identityStorageKey!
      )
      if (persistedIdentity) {
        mergedConfig.identity = persistedIdentity
      }
    }

    // Load persisted features if available
    if (
      mergedConfig.persistFeatures &&
      typeof window !== 'undefined'
    ) {
      const persistedFeatures = localStorage.getItem(
        mergedConfig.featuresStorageKey!
      )
      if (persistedFeatures) {
        try {
          const parsed = JSON.parse(persistedFeatures)
          mergedConfig.featureDefaults = {
            ...parsed,
            ...mergedConfig.featureDefaults,
          }
        } catch {
          // Invalid JSON, ignore
        }
      }
    }

    return createTogglyClient(mergedConfig)
  })

  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [features, setFeatures] = useState<Record<string, boolean>>(
    initialFeatures ?? config.featureDefaults ?? {}
  )
  const [identity, setIdentityState] = useState<string | undefined>(
    config.identity
  )

  useEffect(() => {
    return client.subscribeFeaturesRefresh(() => {
      setFeatures(client.state.features)
      setError(client.state.error)
    })
  }, [client])

  const init = useCallback(
    async (newConfig?: TogglyConfig) => {
      setIsLoading(true)
      setError(null)

      try {
        const defs = await client.init(newConfig)
        setFeatures(defs)
        setIsReady(true)
        setIdentityState(client.identity)

        // Check if client encountered an error
        if (client.state.error) {
          setError(client.state.error)
        }

        // Persist features if enabled
        if (
          !client.state.error &&
          config.persistFeatures &&
          typeof window !== 'undefined'
        ) {
          localStorage.setItem(
            config.featuresStorageKey ?? 'toggly:features',
            JSON.stringify(defs)
          )
        }
      } catch (e) {
        setError(e as Error)
        setIsReady(true)
      } finally {
        setIsLoading(false)
      }
    },
    [client, config.persistFeatures, config.featuresStorageKey]
  )

  const refresh = useCallback(async () => {
    setIsLoading(true)
      setError(client.state.error)

    try {
      const defs = await client.refresh()
      setFeatures(defs)
        setError(client.state.error)

      // Persist features if enabled
        if (!client.state.error && config.persistFeatures && typeof window !== 'undefined') {
        localStorage.setItem(
          config.featuresStorageKey ?? 'toggly:features',
          JSON.stringify(defs)
        )
      }
    } catch (e) {
      setError(e as Error)
    } finally {
      setIsLoading(false)
    }
  }, [client, config.persistFeatures, config.featuresStorageKey])

  const setIdentity = useCallback(
    async (newIdentity: string) => {
      await client.setIdentity(newIdentity)
      setIdentityState(newIdentity)

      // Persist identity if enabled
      if (config.persistIdentity && typeof window !== 'undefined') {
        localStorage.setItem(
          config.identityStorageKey ?? 'toggly:identity',
          newIdentity
        )
      }
    },
    [client, config.persistIdentity, config.identityStorageKey]
  )

  const isFeatureOn = useCallback(
    async (featureKey: string) => {
      return client.isFeatureOn(featureKey)
    },
    [client]
  )

  const isFeatureOff = useCallback(
    async (featureKey: string) => {
      return client.isFeatureOff(featureKey)
    },
    [client]
  )

  const evaluateFeatureGate = useCallback(
    async (
      featureKeys: string[],
      requirement: FeatureRequirement = 'all',
      negate: boolean = false
    ) => {
      return client.evaluateFeatureGate(featureKeys, requirement, negate)
    },
    [client]
  )

  // Auto-initialize on mount
  useEffect(() => {
    if (autoInit && !isReady && !isLoading) {
      init()
    }
  }, [autoInit, init, isReady, isLoading])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      client.destroy()
    }
  }, [client])

  const value = useMemo<TogglyContextValue>(
    () => ({
      client,
      isReady,
      isLoading,
      error,
      features,
      identity,
      init,
      refresh,
      setIdentity,
      isFeatureOn,
      isFeatureOff,
      evaluateFeatureGate,
    }),
    [
      client,
      isReady,
      isLoading,
      error,
      features,
      identity,
      init,
      refresh,
      setIdentity,
      isFeatureOn,
      isFeatureOff,
      evaluateFeatureGate,
    ]
  )

  return (
    <TogglyContext.Provider value={value}>{children}</TogglyContext.Provider>
  )
}

/**
 * Hook to access the Toggly context
 *
 * @example
 * ```tsx
 * 'use client'
 * import { useToggly } from '@ops-ai/nextjs-toggly-client'
 *
 * export function MyComponent() {
 *   const { features, isReady } = useToggly()
 *
 *   if (!isReady) return <div>Loading...</div>
 *
 *   return (
 *     <div>
 *       {features['new-feature'] && <NewFeature />}
 *     </div>
 *   )
 * }
 * ```
 */
export function useToggly(): TogglyContextValue {
  const context = useContext(TogglyContext)

  if (!context) {
    throw new Error(
      '[Toggly] useToggly must be used within a TogglyProvider. ' +
        'Wrap your app with <TogglyProvider> in your providers file.'
    )
  }

  return context
}

/**
 * Get the Toggly context without throwing
 * Useful for optional feature flag checking
 */
export function useTogglyOptional(): TogglyContextValue | undefined {
  return useContext(TogglyContext)
}
