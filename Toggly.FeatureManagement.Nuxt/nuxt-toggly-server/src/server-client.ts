import {
  createTogglyClient,
  type TogglyClient,
  type TogglyConfig,
} from '@ops-ai/nuxt-toggly-core'
import WebSocket from 'ws'
import type { TogglyServerConfig, TogglyStorage } from './types'

/**
 * Default server configuration
 *
 * Live updates use WebSocket (via `ws`) so long-lived Node processes do not
 * poll definitions.toggly.io on every request. refreshInterval stays 0;
 * reconnect + WS push keep flags fresh. Edge runtimes skip WS in core.
 */
const DEFAULT_SERVER_CONFIG = {
  cache: true,
  cacheTtl: 60000, // 1 minute (HTTP response cache helper only)
  cacheKeyPrefix: 'toggly:server:',
  refreshInterval: 0,
  enableLiveUpdates: true,
  webSocketImpl: WebSocket as unknown as TogglyConfig['webSocketImpl'],
}

/**
 * In-memory storage implementation
 */
class MemoryStorage implements TogglyStorage {
  private store = new Map<string, { value: unknown; expires: number | null }>()

  async getItem<T>(key: string): Promise<T | null> {
    const item = this.store.get(key)
    if (!item) return null

    if (item.expires && Date.now() > item.expires) {
      this.store.delete(key)
      return null
    }

    return item.value as T
  }

  async setItem<T>(
    key: string,
    value: T,
    options?: { ttl?: number }
  ): Promise<void> {
    const expires = options?.ttl ? Date.now() + options.ttl : null
    this.store.set(key, { value, expires })
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key)
  }

  async hasItem(key: string): Promise<boolean> {
    const item = await this.getItem(key)
    return item !== null
  }

  clear(): void {
    this.store.clear()
  }
}

// Global server storage instance
let serverStorage: TogglyStorage = new MemoryStorage()

// Global server client instance
let serverClient: TogglyClient | null = null
let serverConfig: TogglyServerConfig | null = null

/**
 * Set custom storage implementation
 */
export function setServerStorage(storage: TogglyStorage): void {
  serverStorage = storage
}

/**
 * Get current server storage
 */
export function getServerStorage(): TogglyStorage {
  return serverStorage
}

/**
 * Create the memory storage
 */
export function createMemoryStorage(): MemoryStorage {
  return new MemoryStorage()
}

/**
 * Initialize the server-side Toggly client
 */
export async function initServerToggly(
  config: TogglyServerConfig
): Promise<TogglyClient> {
  const mergedConfig: TogglyServerConfig = {
    ...DEFAULT_SERVER_CONFIG,
    ...config,
    // Prefer caller overrides; otherwise keep server live-update defaults
    refreshInterval: config.refreshInterval ?? DEFAULT_SERVER_CONFIG.refreshInterval,
    enableLiveUpdates: config.enableLiveUpdates ?? DEFAULT_SERVER_CONFIG.enableLiveUpdates,
    webSocketImpl: config.webSocketImpl ?? DEFAULT_SERVER_CONFIG.webSocketImpl,
  }

  serverConfig = mergedConfig

  // Check for cached definitions
  if (mergedConfig.cache) {
    const cacheKey = `${mergedConfig.cacheKeyPrefix}definitions`
    const cached = await serverStorage.getItem<Record<string, boolean>>(cacheKey)

    if (cached) {
      // Use cached definitions as defaults
      mergedConfig.featureDefaults = {
        ...cached,
        ...mergedConfig.featureDefaults,
      }
    }
  }

  // Create and initialize client
  serverClient = createTogglyClient(mergedConfig as TogglyConfig)
  const definitions = await serverClient.init()

  // Cache the definitions
  if (mergedConfig.cache) {
    const cacheKey = `${mergedConfig.cacheKeyPrefix}definitions`
    await serverStorage.setItem(cacheKey, definitions, {
      ttl: mergedConfig.cacheTtl,
    })
  }

  return serverClient
}

/**
 * Get the server-side Toggly client
 * Returns null if not initialized
 */
export function getServerToggly(): TogglyClient | null {
  return serverClient
}

/**
 * Get the server-side Toggly client, throwing if not initialized
 */
export function useServerToggly(): TogglyClient {
  if (!serverClient) {
    throw new Error(
      '[Toggly] Server client not initialized. Call initServerToggly() first.'
    )
  }
  return serverClient
}

/**
 * Refresh server-side definitions
 */
export async function refreshServerToggly(): Promise<void> {
  if (!serverClient || !serverConfig) {
    return
  }

  const definitions = await serverClient.refresh()

  // Update cache
  if (serverConfig.cache) {
    const cacheKey = `${serverConfig.cacheKeyPrefix}definitions`
    await serverStorage.setItem(cacheKey, definitions, {
      ttl: serverConfig.cacheTtl,
    })
  }
}

/**
 * Check if a feature is enabled on the server
 */
export async function isServerFeatureOn(
  featureKey: string,
  identity?: string
): Promise<boolean> {
  const client = useServerToggly()

  if (identity) {
    // Create a temporary context with the identity
    const originalIdentity = client.identity
    client.identity = identity

    const result = await client.isFeatureOn(featureKey)

    // Restore original identity
    client.identity = originalIdentity

    return result
  }

  return client.isFeatureOn(featureKey)
}

/**
 * Check if a feature is disabled on the server
 */
export async function isServerFeatureOff(
  featureKey: string,
  identity?: string
): Promise<boolean> {
  const isOn = await isServerFeatureOn(featureKey, identity)
  return !isOn
}

/**
 * Reset server client (useful for testing)
 */
export function resetServerToggly(): void {
  if (serverClient) {
    serverClient.destroy()
    serverClient = null
  }
  serverConfig = null
  if (serverStorage instanceof MemoryStorage) {
    serverStorage.clear()
  }
}
