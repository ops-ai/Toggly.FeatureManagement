import { ref, inject, provide, type App, readonly } from 'vue'
import {
  createTogglyClient,
  type TogglyClient,
  type TogglyConfig,
  type FeatureRequirement,
} from '@ops-ai/nuxt-toggly-core'
import type { TogglyClientConfig, UseTogglyReturn } from '../types'
import { TOGGLY_INJECTION_KEY } from '../types'

// Global client instance for SSR hydration
let globalClient: TogglyClient | null = null
let globalConfig: TogglyClientConfig | null = null

/**
 * Create the Toggly composable for the root component
 */
export function createToggly(config: TogglyClientConfig): UseTogglyReturn {
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
  }

  globalConfig = mergedConfig

  // Load persisted identity if available
  if (
    mergedConfig.persistIdentity &&
    typeof localStorage !== 'undefined' &&
    !identity.value
  ) {
    const persistedIdentity = localStorage.getItem(
      mergedConfig.identityStorageKey!
    )
    if (persistedIdentity) {
      identity.value = persistedIdentity
      mergedConfig.identity = persistedIdentity
    }
  }

  // Load persisted features if available
  if (
    mergedConfig.persistFeatures &&
    typeof localStorage !== 'undefined'
  ) {
    const persistedFeatures = localStorage.getItem(
      mergedConfig.featuresStorageKey!
    )
    if (persistedFeatures) {
      try {
        const parsed = JSON.parse(persistedFeatures)
        features.value = parsed
        mergedConfig.featureDefaults = {
          ...parsed,
          ...mergedConfig.featureDefaults,
        }
      } catch {
        // Invalid JSON, ignore
      }
    }
  }

  // Create client
  const client = createTogglyClient(mergedConfig)
  globalClient = client
  client.subscribeFeaturesRefresh?.(() => {
    features.value = client.state.features
    error.value = client.state.error
  })

  const toggly: UseTogglyReturn = {
    client,
    isReady,
    isLoading,
    error,
    features,
    identity,

    async init(newConfig?: TogglyConfig) {
      isLoading.value = true
      error.value = null

      try {
        const defs = await client.init(newConfig)
        features.value = defs
        isReady.value = true

        // Check if client encountered an error (it catches internally)
        if (client.state.error) {
          error.value = client.state.error
        }

        // Persist features if enabled (only if no error)
        if (
          !client.state.error &&
          mergedConfig.persistFeatures &&
          typeof localStorage !== 'undefined'
        ) {
          localStorage.setItem(
            mergedConfig.featuresStorageKey!,
            JSON.stringify(defs)
          )
        }

        // Update identity ref
        identity.value = client.identity
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
        features.value = defs
        error.value = client.state.error

        // Persist features if enabled
        if (
          !client.state.error &&
          mergedConfig.persistFeatures &&
          typeof localStorage !== 'undefined'
        ) {
          localStorage.setItem(
            mergedConfig.featuresStorageKey!,
            JSON.stringify(defs)
          )
        }
      } catch (e) {
        error.value = e as Error
      } finally {
        isLoading.value = false
      }
    },

    async setIdentity(newIdentity: string) {
      await client.setIdentity(newIdentity)
      identity.value = newIdentity

      // Persist identity if enabled
      if (
        mergedConfig.persistIdentity &&
        typeof localStorage !== 'undefined'
      ) {
        localStorage.setItem(mergedConfig.identityStorageKey!, newIdentity)
      }
    },

    async isFeatureOn(featureKey: string) {
      return client.isFeatureOn(featureKey)
    },

    async isFeatureOff(featureKey: string) {
      return client.isFeatureOff(featureKey)
    },

    async evaluateFeatureGate(
      featureKeys: string[],
      requirement: FeatureRequirement = 'all',
      negate: boolean = false
    ) {
      return client.evaluateFeatureGate(featureKeys, requirement, negate)
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
