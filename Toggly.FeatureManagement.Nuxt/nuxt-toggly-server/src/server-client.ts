import {
  createTogglyClient,
  snapshotEvaluatedBooleans,
  type FeatureDefinitionModel,
  type FeatureDefinitions,
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

function definitionsCacheKey(config: TogglyServerConfig): string {
  return `${config.cacheKeyPrefix}definitions`
}

function isDefinitionModelArray(
  value: unknown
): value is FeatureDefinitionModel[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as FeatureDefinitionModel).featureKey === 'string'
    )
  )
}

async function readCachedDefinitions(
  storage: TogglyStorage,
  config: TogglyServerConfig
): Promise<FeatureDefinitionModel[] | null> {
  const cached = await storage.getItem<unknown>(definitionsCacheKey(config))
  return isDefinitionModelArray(cached) ? cached : null
}

async function writeCachedDefinitions(
  storage: TogglyStorage,
  config: TogglyServerConfig,
  client: TogglyClient
): Promise<void> {
  const defs = Array.from(client.getDefinitions().values())
  if (defs.length === 0) {
    return
  }
  await storage.setItem(definitionsCacheKey(config), defs, {
    ttl: config.cacheTtl,
  })
}

function evaluatedSnapshot(client: TogglyClient): FeatureDefinitions {
  const defs = client.getDefinitions()
  if (defs.size === 0) {
    return { ...client.state.features }
  }
  return {
    ...client.config.featureDefaults,
    ...snapshotEvaluatedBooleans(defs, {
      identity: client.config.identity,
      groups: client.config.groups,
      traits: client.config.claims,
    }),
  }
}

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
 * Initialize the server-side Toggly client.
 *
 * Always uses local evaluation (`definitions-signed` + `@ops-ai/toggly-eval`).
 * Durable cache stores raw definition models (not evaluated booleans).
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
    // Server always uses definitions-signed + local evaluation (OPS-825).
    evaluationMode: 'local',
  }

  serverConfig = mergedConfig

  const cachedDefs = mergedConfig.cache
    ? await readCachedDefinitions(serverStorage, mergedConfig)
    : null

  // Create and initialize client
  serverClient = createTogglyClient(mergedConfig as TogglyConfig)
  await serverClient.init()

  // Last-known-good: if fetch failed, hydrate from durable definition cache
  if (serverClient.state.error && cachedDefs && cachedDefs.length > 0) {
    serverClient.hydrateDefinitions(cachedDefs)
  }

  // Persist definition models after a successful fetch (or hydrate)
  if (mergedConfig.cache && serverClient.getDefinitions().size > 0) {
    await writeCachedDefinitions(serverStorage, mergedConfig, serverClient)
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
export async function refreshServerToggly(): Promise<FeatureDefinitions | null> {
  if (!serverClient || !serverConfig) {
    return null
  }

  await serverClient.refresh()

  if (serverConfig.cache && serverClient.getDefinitions().size > 0) {
    await writeCachedDefinitions(serverStorage, serverConfig, serverClient)
  }

  return evaluatedSnapshot(serverClient)
}

/**
 * Check if a feature is enabled on the server.
 * Pass `identity` as a per-call override (local eval); shared client is reused.
 */
export async function isServerFeatureOn(
  featureKey: string,
  identity?: string
): Promise<boolean> {
  const client = useServerToggly()
  return client.isFeatureOn(featureKey, undefined, undefined, identity)
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
