import { Toggly, type TogglyOptions } from '../services/toggly.service'
import { togglyServiceStore, togglyFlagsStore } from '../stores/toggly.store'

/**
 * Initialize Toggly with the provided configuration
 * This function sets up the Toggly service and loads feature flags
 * 
 * @param config - Toggly configuration options
 * @returns Promise that resolves when initialization is complete
 * 
 * @example
 * ```typescript
 * import { createToggly } from '@ops-ai/svelte-feature-flags-toggly'
 * 
 * await createToggly({
 *   appKey: 'your-app-key',
 *   environment: 'Production',
 *   identity: 'user-123'
 * })
 * ```
 */
export async function createToggly(config: TogglyOptions): Promise<void> {
  const toggly = new Toggly(config)
  
  // Set the service in the store
  togglyServiceStore.set(toggly)

  // Wire up flag updates to the Svelte store (used by WebSocket and refreshFlags)
  toggly.onFlagsUpdated = (flags) => {
    togglyFlagsStore.set(flags)
  }

  // Seed the Svelte store from localStorage cache for instant rendering
  // The Toggly constructor already seeds _features, so expose them immediately
  const cachedFeatures = await toggly._featuresLoaded()
  if (cachedFeatures) {
    togglyFlagsStore.set(cachedFeatures)
  }

  // Load fresh features from the API and update the flags store
  try {
    const flags = await toggly._loadFeatures()
    if (flags) {
      togglyFlagsStore.set(flags)
    }
  } catch (error) {
    console.error('Toggly initialization error:', error)
    togglyFlagsStore.set({})
  }

  // Start WebSocket for live updates
  toggly.startWebSocket()

  // Set up periodic refresh if refresh interval is configured
  // When WebSocket is connected, polling is throttled to a 20-minute fallback
  const refreshInterval = config.featureFlagsRefreshInterval ?? 3 * 60 * 1000
  if (refreshInterval > 0 && config.appKey) {
    setInterval(async () => {
      // Throttle polling when WebSocket is connected (20-min fallback)
      if (toggly._wsConnected && (Date.now() - toggly._lastFallbackRefresh) < 20 * 60 * 1000) {
        return
      }

      toggly._lastFallbackRefresh = Date.now()

      try {
        await toggly.refreshFlags()
        const flags = await toggly._loadFeatures()
        if (flags) {
          togglyFlagsStore.set(flags)
        }
      } catch (error) {
        console.warn('Toggly refresh error:', error)
      }
    }, refreshInterval)
  }
}

export default createToggly
