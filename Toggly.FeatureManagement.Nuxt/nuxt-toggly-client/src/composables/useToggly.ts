import { ref, inject, provide, type App, readonly } from 'vue'
import {
  createTogglyClient,
  type TogglyClient,
  type TogglyConfig,
  type FeatureRequirement,
} from '@ops-ai/nuxt-toggly-core/browser'
import type { TogglyClientConfig, UseTogglyReturn } from '../types'
import { TOGGLY_INJECTION_KEY } from '../types'
import { createBrowserTelemetry } from '../frontend-telemetry'

// Global client instance for SSR hydration
let globalClient: TogglyClient | null = null
let globalConfig: TogglyClientConfig | null = null

/**
 * Create the Toggly composable for the root component
 */
export function createToggly(config: TogglyClientConfig): UseTogglyReturn {
  if (typeof window !== 'undefined' && globalClient) {
    globalClient.destroy()
    globalClient = null
  }
  const isReady = ref(false)
  const isLoading = ref(false)
  const error = ref<Error | null>(null)
  const features = ref<Record<string, boolean>>({ ...config.featureDefaults })
  const identity = ref<string | undefined>(config.identity)

  // Merge config with defaults
  const mergedConfig: TogglyClientConfig = {
    persistIdentity: true,
    identityStorageKey: 'toggly:identity',
    persistFeatures: false,
    featuresStorageKey: 'toggly:features',
    ...config,
    ...(typeof window !== 'undefined'
      ? {
          enableTelemetry: config.enableTelemetry ?? true,
          enableUsageTracking: config.enableUsageTracking ?? true,
          enableMetrics: config.enableMetrics ?? true,
          frontendTelemetryFactory: createBrowserTelemetry,
        }
      : {}),
  }

  if (typeof window !== 'undefined') globalConfig = mergedConfig

  // Storage is optional, including browsers that throw from its getter.
  try {
    if (mergedConfig.persistIdentity && typeof localStorage !== 'undefined' && !identity.value) {
      const persistedIdentity = localStorage.getItem(mergedConfig.identityStorageKey!)
      if (persistedIdentity) {identity.value = persistedIdentity; mergedConfig.identity = persistedIdentity}
    }
  } catch { /* Continue with the configured in-memory identity. */ }

  // Create client
  const client = createTogglyClient(mergedConfig)
  features.value = client.state.features as Record<string, boolean>
  function persistIdentity() {
    if (mergedConfig.persistIdentity) try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(mergedConfig.identityStorageKey!, client.identity ?? '')
    } catch { /* Optional persistence must not prevent context changes. */ }
  }
  if (typeof window !== 'undefined') globalClient = client
  client.subscribeFeaturesRefresh?.(() => {
    features.value = client.state.features as Record<string, boolean>
    error.value = client.state.error
  })

  const toggly: UseTogglyReturn = {
    client,
    isReady,
    isLoading,
    error,
    features,
    identity,
    telemetry: {
      recordUsage: (featureKey, variant) => client.recordUsage(featureKey, undefined, variant),
      recordView: (featureKey, variant) => client.recordView(featureKey, undefined, variant),
      incrementCounter: (metricKey, value) => client.incrementCounter(metricKey, value),
      setGauge: (metricKey, value) => client.setGauge(metricKey, value),
      flushTelemetry: () => client.flushTelemetry(),
    },

    async init(newConfig?: TogglyConfig) {
      isLoading.value = true
      error.value = null

      try {
        const defs = await client.init(newConfig)
        features.value = defs as Record<string, boolean>
        isReady.value = true

        // Check if client encountered an error (it catches internally)
        if (client.state.error) {
          error.value = client.state.error
        }

        // Update identity ref
        identity.value = client.identity
        persistIdentity()
      } catch (e) {
        error.value = e as Error
        // Still mark as ready since we use defaults
        isReady.value = true
      } finally {
        isLoading.value = false
      }
    },

    async refresh() {
      isLoading.value = true
      error.value = client.state.error

      try {
        const defs = await client.refresh()
        features.value = defs as Record<string, boolean>
        error.value = client.state.error

      } catch (e) {
        features.value = client.state.features as Record<string, boolean>
        error.value = e as Error
        throw e
      } finally {
        isLoading.value = false
      }
    },

    async setIdentity(newIdentity: string) {
      return toggly.setContext({identity: newIdentity})
    },

    async setContext(update) {
      try {
        await client.setContext(update)
        error.value = client.state.error
      } catch (e) {
        error.value = e as Error
        throw e
      } finally {
        identity.value = client.identity
        features.value = client.state.features as Record<string, boolean>
        persistIdentity()
      }
    },

    async isFeatureOn(
      featureKey: string,
      context?: import('@ops-ai/nuxt-toggly-core/browser').TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
    ) {
      return client.isFeatureOn(featureKey, context, kind)
    },

    async isFeatureOff(
      featureKey: string,
      context?: import('@ops-ai/nuxt-toggly-core/browser').TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
    ) {
      return client.isFeatureOff(featureKey, context, kind)
    },

    async evaluateFeatureGate(
      featureKeys: string[],
      requirement: FeatureRequirement = 'all',
      negate: boolean = false,
      context?: import('@ops-ai/nuxt-toggly-core/browser').TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
    ) {
      return client.evaluateFeatureGate(featureKeys, requirement, negate, context, kind)
    },
  }

  return toggly
}

/**
 * Use the Toggly composable in child components
 * Must be used within a component tree that has Toggly provided
 */
export function useToggly(): UseTogglyReturn {
  const toggly = inject(TOGGLY_INJECTION_KEY)

  if (!toggly) {
    throw new Error(
      '[Toggly] useToggly() was called but no Toggly instance was found. ' +
        'Did you forget to call provideToggly() in a parent component?'
    )
  }

  return toggly
}

/**
 * Provide Toggly to child components
 */
export function provideToggly(toggly: UseTogglyReturn): void {
  provide(TOGGLY_INJECTION_KEY, toggly)
}

/**
 * Get the global Toggly client (for use outside of Vue components)
 */
export function getTogglyClient(): TogglyClient | null {
  return globalClient
}

/**
 * Install Toggly as a Vue plugin
 */
export function createTogglyPlugin(config: TogglyClientConfig) {
  return {
    install(app: App) {
      const toggly = createToggly(config)
      app.provide(TOGGLY_INJECTION_KEY, toggly)

      // Auto-initialize if appKey is provided
      if (config.appKey) {
        toggly.init()
      }
    },
  }
}

/**
 * Reset global state (for testing)
 */
export function resetToggly(): void {
  if (globalClient) {
    globalClient.destroy()
    globalClient = null
  }
  globalConfig = null
}
