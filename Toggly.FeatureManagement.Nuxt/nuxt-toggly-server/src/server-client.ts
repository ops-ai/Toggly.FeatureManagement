import {
  createTogglyClient,
  snapshotEvaluatedBooleans,
  resolveTelemetryEnableFlag,
  isEdgeRuntime,
  type FeatureDefinitionModel,
  type FeatureDefinitions,
  type TogglyClient,
  type TogglyConfig,
} from '@ops-ai/nuxt-toggly-core'
import { createGrpcClients, isGrpcAvailable } from '@ops-ai/nuxt-toggly-core/telemetry/grpc'
import WebSocket from 'ws'
import {
  resolveFeatureCheckArgs,
  toEvalOverrides,
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
 * Usage + metrics telemetry defaults on when appKey is set (gRPC optional deps
 * on Node; HTTPS for Nitro edge / Workers-like targets).
 */
const DEFAULT_SERVER_CONFIG = {
  cache: true,
  cacheTtl: 60000, // 1 minute (HTTP response cache helper only)
  cacheKeyPrefix: 'toggly:server:',
  refreshInterval: 0,
  enableLiveUpdates: true,
  webSocketImpl: WebSocket as unknown as TogglyConfig['webSocketImpl'],
  telemetryTransport: 'grpc' as const,
  telemetryAttachProcessHandlers: true,
}

function resolveServerTelemetryTransport(
  config: TogglyServerConfig,
): 'grpc' | 'https' {
  if (config.telemetryTransport) {
    return config.telemetryTransport
  }
  // Nitro edge / Workers-like: gateway HTTPS JSON (no Node gRPC).
  if (isEdgeRuntime()) {
    return 'https'
  }
  return DEFAULT_SERVER_CONFIG.telemetryTransport
}

function resolveServerTelemetryFlags(
  config: TogglyServerConfig,
): Pick<TogglyServerConfig, 'enableUsageTracking' | 'enableMetrics'> {
  const hasAppKey = Boolean(config.appKey)
  // TOGGLY_DISABLE_TELEMETRY=1 is authoritative over explicit true.
  return {
    enableUsageTracking: resolveTelemetryEnableFlag(
      config.enableUsageTracking,
      hasAppKey,
    ),
    enableMetrics: resolveTelemetryEnableFlag(config.enableMetrics, hasAppKey),
  }
}

function resolveGrpcClients(config: TogglyServerConfig): {
  usageClient?: TogglyConfig['usageClient']
  metricsClient?: TogglyConfig['metricsClient']
} {
  if (config.usageClient !== undefined || config.metricsClient !== undefined) {
    return {
      usageClient: config.usageClient,
      metricsClient: config.metricsClient,
    }
  }

  const transport = resolveServerTelemetryTransport(config)
  if (transport === 'https') {
    // TelemetryRuntime builds soft-fail HTTPS clients.
    return {}
  }

  const flags = resolveServerTelemetryFlags(config)
  if (!flags.enableUsageTracking && !flags.enableMetrics) {
    return {}
  }

  if (!isGrpcAvailable()) {
    console.warn(
      '[Toggly] Usage/metrics enabled but @grpc/grpc-js and @grpc/proto-loader are not installed. ' +
        'Install them to send telemetry: npm install @grpc/grpc-js @grpc/proto-loader',
    )
    return { usageClient: null, metricsClient: null }
  }

  const clients = createGrpcClients(config.metricsBaseUrl)
  if (!clients) {
    console.warn('[Toggly] Failed to create gRPC clients; telemetry transport disabled')
    return { usageClient: null, metricsClient: null }
  }
  return { usageClient: clients.usage, metricsClient: clients.metrics }
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
  const telemetryFlags = resolveServerTelemetryFlags(config)
  const telemetryTransport = resolveServerTelemetryTransport(config)
  const grpcClients = resolveGrpcClients(config)
  const mergedConfig: TogglyServerConfig = {
    ...DEFAULT_SERVER_CONFIG,
    ...config,
    ...telemetryFlags,
    ...grpcClients,
    // Prefer caller overrides; otherwise keep server live-update defaults
    refreshInterval: config.refreshInterval ?? DEFAULT_SERVER_CONFIG.refreshInterval,
    enableLiveUpdates: config.enableLiveUpdates ?? DEFAULT_SERVER_CONFIG.enableLiveUpdates,
    webSocketImpl: config.webSocketImpl ?? DEFAULT_SERVER_CONFIG.webSocketImpl,
    telemetryTransport,
    telemetryAttachProcessHandlers:
      config.telemetryAttachProcessHandlers ??
      (telemetryTransport === 'https'
        ? false
        : DEFAULT_SERVER_CONFIG.telemetryAttachProcessHandlers),
    // Server always uses definitions-signed + local evaluation (OPS-825).
    evaluationMode: 'local',
  }

  serverConfig = mergedConfig

  const cachedDefs = mergedConfig.cache
    ? await readCachedDefinitions(serverStorage, mergedConfig)
    : null

  // Create and initialize client
  serverClient = createTogglyClient(mergedConfig as TogglyConfig)

  // Startup from durable snapshot before first network (counted in core init).
  if (cachedDefs && cachedDefs.length > 0) {
    serverClient.hydrateDefinitions(cachedDefs)
  }

  await serverClient.init()

  // Last-known-good: if fetch failed, hydrate from durable definition cache
  if (serverClient.state.error && cachedDefs && cachedDefs.length > 0) {
    // Only re-hydrate when network wiped / left empty defs
    if (serverClient.getDefinitions().size === 0) {
      serverClient.hydrateDefinitions(cachedDefs)
    }
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
 * Pass a user `identity` string or
 * `{ identity, groups, claims, request, headers }` for per-call local eval.
 */
export async function isServerFeatureOn(
  featureKey: string,
  identityOrOptions?: string | FeatureCheckOptions
): Promise<boolean> {
  const client = useServerToggly()
  const options = resolveFeatureCheckArgs(identityOrOptions)
  return client.isFeatureOn(
    featureKey,
    undefined,
    undefined,
    toEvalOverrides(options),
  )
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
 * Reset server client (useful for testing). Flushes telemetry best-effort.
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

/**
 * Record a feature "used" interaction on the server client.
 */
export function recordServerUsage(
  featureKey: string,
  identity?: string,
  variant?: string,
): void {
  serverClient?.recordUsage(featureKey, identity, variant)
}

/**
 * Record a feature "viewed" event on the server client.
 */
export function recordServerView(
  featureKey: string,
  identity?: string,
  variant?: string,
): void {
  serverClient?.recordView(featureKey, identity, variant)
}

/** Aggregate a measure metric. */
export function measureServerMetric(
  metricKey: string,
  value: number,
  options?: { feature?: string; variant?: string },
): void {
  serverClient?.measure(metricKey, value, options)
}

/** Increment a counter metric. */
export function incrementServerCounter(
  metricKey: string,
  value = 1,
  options?: { feature?: string; variant?: string },
): void {
  serverClient?.incrementCounter(metricKey, value, options)
}

/** Record a point-in-time observation. */
export function observeServerMetric(
  metricKey: string,
  value: number,
  options?: { feature?: string; variant?: string },
): void {
  serverClient?.observe(metricKey, value, options)
}

/** Flush pending usage + metrics batches. */
export async function flushServerTelemetry(): Promise<void> {
  await serverClient?.flushTelemetry()
}

/**
 * Close the server client and flush telemetry (best-effort).
 */
export async function closeServerToggly(): Promise<void> {
  if (serverClient) {
    await serverClient.flushTelemetry()
    serverClient.destroy()
    serverClient = null
  }
  serverConfig = null
}
