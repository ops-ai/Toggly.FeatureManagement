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
  
  // Load features and update the flags store
  try {
    const flags = await toggly._loadFeatures()
    if (flags) {
      togglyFlagsStore.set(flags)
    }
  } catch (error) {
    console.error('Toggly initialization error:', error)
    // Set empty flags on error, defaults will be used
    togglyFlagsStore.set({})
  }

  // Set up periodic refresh if refresh interval is configured
  const refreshInterval = config.featureFlagsRefreshInterval ?? 3 * 60 * 1000
  if (refreshInterval > 0 && config.appKey) {
    setInterval(async () => {
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
