import {
  createTogglyClient,
  snapshotEvaluatedBooleans,
  toBooleanDefinitions,
  type FeatureDefinitionModel,
  type TogglyClient,
  type TogglyConfig,
  type FeatureDefinitions,
} from '@ops-ai/nextjs-toggly-core'
import WebSocket from 'ws'
import {
  resolveFeatureCheckArgs,
  type FeatureCheckOptions,
} from './feature-check'
import type { TogglyServerConfig, TogglyStorage } from './types'

/**
 * Default server configuration
 *
 * Live updates use WebSocket (via `ws`) so long-lived Node processes do not
 * poll definitions.toggly.io on every request. refreshInterval stays 0;
 * reconnect + WS push keep flags fresh. Edge runtimes skip WS in core.
 *
 * Server packages always evaluate locally (definitions-signed + toggly-eval).
 */
const DEFAULT_SERVER_CONFIG = {
  cache: true,
  cacheTtl: 60000, // 1 minute (HTTP response cache helper only)
  cacheKeyPrefix: 'toggly:server:',
  refreshInterval: 0,
  enableLiveUpdates: true,
  evaluationMode: 'local' as const,
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

// Process-wide singleton. Next/Turbopack can evaluate this module in multiple
// bundles; pin on globalThis so RSC + Route Handlers share one live client.
type TogglyServerGlobals = {
  __togglyServerStorage?: TogglyStorage
  __togglyServerClient?: TogglyClient | null
  __togglyServerConfig?: TogglyServerConfig | null
  /** Coalesces concurrent initServerToggly calls onto one in-flight promise. */
  __togglyServerInitPromise?: Promise<TogglyClient> | null
}

const togglyGlobal = globalThis as typeof globalThis & TogglyServerGlobals

function getServerStorageRef(): TogglyStorage {
  if (!togglyGlobal.__togglyServerStorage) {
    togglyGlobal.__togglyServerStorage = new MemoryStorage()
  }
  return togglyGlobal.__togglyServerStorage
}

function getServerClientRef(): TogglyClient | null {
  return togglyGlobal.__togglyServerClient ?? null
}

function setServerClientRef(client: TogglyClient | null): void {
  togglyGlobal.__togglyServerClient = client
}

function getServerConfigRef(): TogglyServerConfig | null {
  return togglyGlobal.__togglyServerConfig ?? null
}

function setServerConfigRef(config: TogglyServerConfig | null): void {
  togglyGlobal.__togglyServerConfig = config
}

function getInitPromiseRef(): Promise<TogglyClient> | null {
  return togglyGlobal.__togglyServerInitPromise ?? null
}

function setInitPromiseRef(promise: Promise<TogglyClient> | null): void {
  togglyGlobal.__togglyServerInitPromise = promise
}

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
    return toBooleanDefinitions({ ...client.state.features })
  }
  return toBooleanDefinitions({
    ...client.config.featureDefaults,
    ...snapshotEvaluatedBooleans(defs, {
      identity: client.config.identity,
      groups: client.config.groups,
      traits: client.config.claims,
    }),
  })
}

/**
 * Set custom storage implementation
 */
export function setServerStorage(storage: TogglyStorage): void {
  togglyGlobal.__togglyServerStorage = storage
}

/**
 * Get current server storage
 */
export function getServerStorage(): TogglyStorage {
  return getServerStorageRef()
}

/**
 * Create the memory storage
 */
export function createMemoryStorage(): TogglyStorage {
  return new MemoryStorage()
}

async function createAndBindServerClient(
  config: TogglyServerConfig
): Promise<TogglyClient> {
  const mergedConfig: TogglyServerConfig = {
    ...DEFAULT_SERVER_CONFIG,
    ...config,
    // Prefer caller overrides; otherwise keep server live-update defaults
    refreshInterval: config.refreshInterval ?? DEFAULT_SERVER_CONFIG.refreshInterval,
    enableLiveUpdates:
      config.enableLiveUpdates ?? DEFAULT_SERVER_CONFIG.enableLiveUpdates,
    webSocketImpl: config.webSocketImpl ?? DEFAULT_SERVER_CONFIG.webSocketImpl,
    // Server package is always on the local evaluation rail
    evaluationMode: 'local',
  }

  setServerConfigRef(mergedConfig)
  const serverStorage = getServerStorageRef()

  // Install the new client before any await so concurrent Feature / helper
  // reads never observe a null singleton mid-init (Turbopack double-invoke).
  const previousClient = getServerClientRef()
  const serverClient = createTogglyClient(mergedConfig as TogglyConfig)
  setServerClientRef(serverClient)

  try {
    const cachedDefs = mergedConfig.cache
      ? await readCachedDefinitions(serverStorage, mergedConfig)
      : null

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
  } catch (error) {
    if (getServerClientRef() === serverClient) {
      setServerClientRef(previousClient)
    }
    throw error
  } finally {
    if (previousClient && previousClient !== getServerClientRef()) {
      previousClient.destroy()
    }
  }
}

/**
 * Initialize the server-side Toggly client
 *
 * Always uses local evaluation (`definitions-signed` + `@ops-ai/toggly-eval`).
 * Durable cache stores raw definition models (not evaluated booleans).
 *
 * Concurrent calls share one in-flight promise (Turbopack / parallel RSC
 * often double-invoke init before the singleton is set).
 */
export async function initServerToggly(
  config: TogglyServerConfig
): Promise<TogglyClient> {
  const inFlight = getInitPromiseRef()
  if (inFlight) {
    return inFlight
  }

  const initPromise = createAndBindServerClient(config)
  setInitPromiseRef(initPromise)
  try {
    return await initPromise
  } finally {
    if (getInitPromiseRef() === initPromise) {
      setInitPromiseRef(null)
    }
  }
}

/**
 * Get the server-side Toggly client
 * Returns null if not initialized
 */
export function getServerToggly(): TogglyClient | null {
  return getServerClientRef()
}

/**
 * Await an in-flight init if the singleton is not ready yet.
 * Returns null when no client exists and nothing is initializing.
 */
export async function waitForServerToggly(): Promise<TogglyClient | null> {
  const existing = getServerClientRef()
  if (existing) {
    return existing
  }

  const inFlight = getInitPromiseRef()
  if (!inFlight) {
    return null
  }

  try {
    return await inFlight
  } catch {
    return getServerClientRef()
  }
}

/**
 * Get the server-side Toggly client, throwing if not initialized
 */
export function useServerToggly(): TogglyClient {
  const serverClient = getServerClientRef()
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
  const serverClient = getServerClientRef()
  const serverConfig = getServerConfigRef()
  if (!serverClient || !serverConfig) {
    return null
  }

  await serverClient.refresh()

  if (serverConfig.cache && serverClient.getDefinitions().size > 0) {
    await writeCachedDefinitions(
      getServerStorageRef(),
      serverConfig,
      serverClient
    )
  }

  return evaluatedSnapshot(serverClient)
}

/**
 * Check if a feature is enabled on the server.
 * Pass a user `identity` string or `{ identity, context, contextKind }` for
 * per-call local eval. The shared client is reused; identity is not mutated.
 */
export async function isServerFeatureOn(
  featureKey: string,
  identityOrOptions?: string | FeatureCheckOptions
): Promise<boolean> {
  const client = useServerToggly()
  const { identity, context, contextKind } =
    resolveFeatureCheckArgs(identityOrOptions)
  return client.isFeatureOn(featureKey, context, contextKind, identity)
}

/**
 * Check if a feature is disabled on the server
 */
export async function isServerFeatureOff(
  featureKey: string,
  identityOrOptions?: string | FeatureCheckOptions
): Promise<boolean> {
  const isOn = await isServerFeatureOn(featureKey, identityOrOptions)
  return !isOn
}

/**
 * Get all feature definitions as an evaluated boolean snapshot (for SSR/SSG).
 * Uses the shared client's config identity / groups / claims.
 */
export function getServerFeatures(): FeatureDefinitions {
  const serverClient = getServerClientRef()
  if (!serverClient) {
    return {}
  }
  return evaluatedSnapshot(serverClient)
}

/**
 * Reset server client (useful for testing)
 */
export function resetServerToggly(): void {
  setInitPromiseRef(null)
  const serverClient = getServerClientRef()
  if (serverClient) {
    serverClient.destroy()
    setServerClientRef(null)
  }
  setServerConfigRef(null)
  const serverStorage = getServerStorageRef()
  if (serverStorage instanceof MemoryStorage) {
    serverStorage.clear()
  }
}
