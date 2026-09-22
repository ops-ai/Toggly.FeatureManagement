import { toBooleanDefinitions } from '@ops-ai/toggly-hooks-types'
import { get } from 'svelte/store'
import { Toggly, type TogglyOptions } from '../services/toggly.service'
import {
  togglyServiceStore,
  togglyFlagsStore,
  togglyVariantsStore,
  togglyLocalGatesRevision,
  _setTogglyServiceSnapshot,
} from '../stores/toggly.store'

let pendingInitialization: Toggly | null = null

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
  pendingInitialization?.dispose()
  pendingInitialization = toggly
  togglyServiceStore.set(null)
  const isPending = () => !toggly.isDisposed && pendingInitialization === toggly
  const isActive = () => !toggly.isDisposed && get(togglyServiceStore) === toggly
  
  // Wire up flag updates to the Svelte store (used by WebSocket and refreshFlags)
  toggly.onFlagsUpdated = (flags) => {
    if (isActive()) togglyFlagsStore.set(toBooleanDefinitions(flags))
  }

  toggly.onVariantsUpdated = (defs) => {
    if (isActive()) togglyVariantsStore.set(defs)
  }

  toggly.onLocalGatesUpdated = () => {
    if (isActive()) togglyLocalGatesRevision.update((n) => n + 1)
  }

  if (!config.enableVariants) {
    togglyVariantsStore.set({})
  }

  // Seed the Svelte store from localStorage cache for instant rendering
  // The Toggly constructor already seeds _features, so expose them immediately
  let features = await toggly._featuresLoaded()
  if (!isPending()) return

  // Load fresh features from the API and update the flags store
  try {
    features = await toggly._loadFeatures()
    if (!isPending()) return
  } catch (error) {
    if (!isPending()) return
    console.error('Toggly initialization error:', error)
  }

  if (!isPending()) return
  pendingInitialization = null
  _setTogglyServiceSnapshot(
    toggly,
    features ? toBooleanDefinitions(features) : {},
    config.enableVariants ? (toggly.getVariantDefinitions() ?? {}) : {},
  )

  // Start WebSocket for live updates
  toggly.startWebSocket()

  // Set up periodic refresh if refresh interval is configured
  // When WebSocket is connected, polling is throttled to a 20-minute fallback
  const refreshInterval = config.featureFlagsRefreshInterval ?? 3 * 60 * 1000
  if (refreshInterval > 0 && config.appKey) {
    const timer = setInterval(async () => {
      if (!isActive()) return
      // Throttle polling when WebSocket is connected (20-min fallback)
      if (toggly._wsConnected && (Date.now() - toggly._lastFallbackRefresh) < 20 * 60 * 1000) {
        return
      }

      toggly._lastFallbackRefresh = Date.now()

      try {
        await toggly.refreshFlags()
        if (!isActive()) return
        const flags = await toggly._loadFeatures()
        if (!isActive()) return
        if (flags) {
          togglyFlagsStore.set(toBooleanDefinitions(flags))
        }
      } catch (error) {
        console.warn('Toggly refresh error:', error)
      }
    }, refreshInterval)
    toggly.setRefreshTimer(timer)
  }
}

export default createToggly
