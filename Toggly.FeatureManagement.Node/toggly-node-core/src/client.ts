import type {
  TogglyClient,
  TogglyServerConfig,
  TogglyState,
  FeatureDefinitions,
  FeatureDefinitionsResponse,
  FeatureRequirement,
  EvaluationContext,
  Hook,
} from './types.js'
import { DEFAULT_CONFIG, INITIAL_STATE, CACHE_KEYS } from './constants.js'
import { HookExecutor } from './hooks.js'
import {
  MemoryCacheProvider,
  FileCacheProvider,
  DefinitionsCache,
} from './cache.js'
import {
  generateUUID,
  evaluateGate,
  deepMerge,
  createLogger,
} from './utils.js'
import WebSocket from 'ws'
import {
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  REFRESH_DEBOUNCE_MS,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  shouldFetchOnSync,
  type WsSyncMessage,
} from './ws-sync.js'
import { buildDefinitionFetchHeaders } from './sdk-identity.js'

/**
 * Create a new Toggly client
 */
export function createTogglyClient(
  initialConfig: TogglyServerConfig = {}
): TogglyClient {
  // Merge config with defaults
  let config: TogglyServerConfig = deepMerge(
    DEFAULT_CONFIG as TogglyServerConfig,
    initialConfig
  )

  // Initialize state
  const state: TogglyState = { ...INITIAL_STATE }

  // Initialize logger
  let logger = createLogger(config.debug ?? false)

  // Initialize hook executor
  const hookExecutor = new HookExecutor(config.debug)

  // Register initial hooks
  if (config.hooks) {
    for (const hook of config.hooks) {
      hookExecutor.addHook(hook)
    }
  }

  // Initialize cache
  let cache: DefinitionsCache | null = null
  if (config.cacheProvider) {
    cache = new DefinitionsCache(config.cacheProvider, config.debug)
  } else if (config.enableFileCache) {
    cache = new DefinitionsCache(
      new FileCacheProvider(config.fileCachePath ?? '.toggly-cache', config.debug),
      config.debug
    )
  } else {
    // Default to memory cache
    cache = new DefinitionsCache(new MemoryCacheProvider(), config.debug)
  }

  // Refresh interval timer
  let refreshTimer: NodeJS.Timeout | null = null

  // WebSocket live updates
  let ws: WebSocket | null = null
  let wsConnected = false
  let wsReconnectTimer: NodeJS.Timeout | null = null
  let wsReconnectAttempt = 0
  let refreshDebounceTimer: NodeJS.Timeout | null = null
  let cachedDefinitionsRevision: string | null = null
  let lastFallbackRefresh = 0
  const FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000 // 20 minutes

  // Streaming event source (for SSE) - legacy, kept for backward compat
  let streamingAbortController: AbortController | null = null

  function getDefinitionsRevision(): string | null {
    return cachedDefinitionsRevision ?? state.etag
  }

  function cacheDefinitionsRevision(revision: string | null | undefined): void {
    if (!revision) {
      return
    }
    cachedDefinitionsRevision = revision
    state.etag = revision
  }

  function scheduleDebouncedRefresh(forceJwksRefresh = false): void {
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer)
    }
    refreshDebounceTimer = setTimeout(() => {
      refreshDebounceTimer = null
      if (forceJwksRefresh) {
        cachedDefinitionsRevision = null
        state.etag = null
      }
      refresh().catch((error) => {
        logger.error('WebSocket-triggered refresh failed:', error)
      })
    }, REFRESH_DEBOUNCE_MS)
  }

  function handleWsSyncMessage(message: WsSyncMessage): void {
    const previousRevision = getDefinitionsRevision()
    if (shouldFetchOnSync(message, previousRevision)) {
      scheduleDebouncedRefresh()
    }
    if (message.etag) {
      cacheDefinitionsRevision(message.etag)
    }
  }

  function handleWsUpdateMessage(message: WsSyncMessage): void {
    if (shouldFetchOnSigningKeyUpdated(message)) {
      scheduleDebouncedRefresh(true)
      return
    }
    const previousRevision = getDefinitionsRevision()
    if (shouldFetchOnFlagsUpdated(message, previousRevision)) {
      scheduleDebouncedRefresh()
    }
    if (message.etag) {
      cacheDefinitionsRevision(message.etag)
    }
  }

  /**
   * Build the API URL for fetching definitions
   */
  function buildApiUrl(): string {
    const baseUrl = config.baseUrl ?? DEFAULT_CONFIG.baseUrl
    const appKey = config.appKey
    const environment = config.environment ?? DEFAULT_CONFIG.environment

    if (!appKey) {
      throw new Error('Toggly: appKey is required for API mode')
    }

    let url = `${baseUrl}/evaluated-signed/${appKey}/${environment}`

    if (config.identity) {
      url += `?u=${encodeURIComponent(config.identity)}`
    }

    return url
  }

  /**
   * Fetch feature definitions from API
   */
  async function fetchDefinitions(): Promise<FeatureDefinitions> {
    if (!config.appKey) {
      logger.debug('No appKey provided, using defaults only')
      return config.featureDefaults ?? {}
    }

    const url = buildApiUrl()
    const revision = getDefinitionsRevision()
    const headers = buildDefinitionFetchHeaders({
      'Content-Type': 'application/json',
      ...(config.identity ? { 'x-toggly-identity': config.identity } : {}),
      ...(config.useEtag && revision ? { 'If-None-Match': revision } : {}),
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      config.timeout ?? DEFAULT_CONFIG.timeout
    )

    try {
      logger.debug('Fetching definitions from:', url)

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const responseRevision = extractDefinitionsRevision(response)
      if (responseRevision) {
        cacheDefinitionsRevision(responseRevision.replace(/^"+|"+$/g, ''))
      }

      // Handle 304 Not Modified
      if (response.status === 304) {
        logger.debug('Definitions unchanged (304)')
        return state.features
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = (await response.json()) as
        | FeatureDefinitionsResponse
        | Array<{ featureKey: string; filters?: Array<{ name?: string }> }>
      const features: FeatureDefinitions = {}
      if (Array.isArray(data)) {
        for (const definition of data) {
          features[definition.featureKey] = !!definition.filters?.some((filter) => filter.name === 'AlwaysOn')
        }
      } else if ('defs' in data && data.defs) {
        Object.assign(features, data.defs)
      } else if ('features' in data && Array.isArray(data.features)) {
        for (const feature of data.features) {
          features[feature.featureKey] = feature.enabled
        }
      }

      logger.debug('Fetched', Object.keys(features).length, 'features')

      return features
    } catch (error) {
      clearTimeout(timeoutId)

      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timeout')
      }

      throw error
    }
  }

  /**
   * Refresh feature definitions
   */
  async function refresh(): Promise<FeatureDefinitions> {
    state.loading = true
    state.error = null

    try {
      const features = await fetchDefinitions()

      // Merge with defaults (defaults are fallback, not override)
      state.features = {
        ...config.featureDefaults,
        ...features,
      }

      state.lastRefresh = Date.now()

      // Cache definitions
      if (cache) {
        await cache.setDefinitions(CACHE_KEYS.DEFINITIONS, state.features)
      }

      // Execute afterRefresh hooks
      await hookExecutor.executeAfterRefresh(state.features)

      logger.debug('Features refreshed successfully')

      return state.features
    } catch (error) {
      state.error = error as Error
      logger.error('Failed to refresh features:', error)

      // Try to load from cache on error
      if (cache) {
        const cachedFeatures = await cache.getDefinitions(CACHE_KEYS.DEFINITIONS)
        if (cachedFeatures) {
          logger.debug('Using cached definitions')
          state.features = {
            ...config.featureDefaults,
            ...cachedFeatures,
          }
          return state.features
        }
      }

      // Fall back to defaults
      state.features = config.featureDefaults ?? {}
      await hookExecutor.executeOnError(error as Error, 'refresh')

      return state.features
    } finally {
      state.loading = false
    }
  }

  /**
   * Start automatic refresh interval
   */
  function startRefreshInterval(): void {
    const interval = config.refreshInterval ?? DEFAULT_CONFIG.refreshInterval

    if (interval <= 0) {
      logger.debug('Refresh interval disabled')
      return
    }

    if (refreshTimer) {
      clearInterval(refreshTimer)
    }

    refreshTimer = setInterval(() => {
      // When WebSocket is connected, throttle HTTP polls to fallback interval
      if (wsConnected) {
        const now = Date.now()
        if (now - lastFallbackRefresh < FALLBACK_REFRESH_INTERVAL) {
          return
        }
        lastFallbackRefresh = now
      }
      refresh().catch((error) => {
        logger.error('Background refresh failed:', error)
      })
    }, interval)

    logger.debug(`Refresh interval started: ${interval}ms`)
  }

  /**
   * Stop automatic refresh interval
   */
  function stopRefreshInterval(): void {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
      logger.debug('Refresh interval stopped')
    }
  }

  /**
   * Build the WebSocket URL for live updates
   */
  function buildWsUrl(): string {
    if (config.streamingUrl) {
      return config.streamingUrl
    }
    return buildWebSocketUrl(
      config.baseUrl ?? DEFAULT_CONFIG.baseUrl,
      config.appKey!,
      getDefinitionsRevision(),
    )
  }

  /**
   * Start WebSocket connection for live updates
   */
  function startStreaming(): void {
    if (!config.appKey) {
      return
    }

    // enableStreaming defaults to true when appKey is set
    if (config.enableStreaming === false) {
      return
    }

    if (ws) {
      return
    }

    const wsUrl = buildWsUrl()
    logger.debug('Connecting WebSocket to:', wsUrl)

    try {
      ws = new WebSocket(wsUrl)

      ws.on('open', () => {
        wsConnected = true
        wsReconnectAttempt = 0
        lastFallbackRefresh = Date.now()
        logger.debug('WebSocket connected')
      })

      ws.on('message', (data: Buffer) => {
        const text = data.toString()
        if (text === 'update' || text === 'flags-updated') {
          scheduleDebouncedRefresh()
          return
        }

        try {
          const msg = JSON.parse(text) as WsSyncMessage
          if (msg.type === 'ping') {
            return
          }
          if (msg.type === 'sync') {
            handleWsSyncMessage(msg)
            return
          }
          if (msg.type === 'flags-updated' || msg.type === 'update' || msg.type === 'signing-key-updated') {
            handleWsUpdateMessage(msg)
          }
        } catch {
          // Non-JSON message already handled above
        }
      })

      ws.on('close', () => {
        wsConnected = false
        ws = null
        logger.debug('WebSocket disconnected, reconnecting in 5s')
        scheduleReconnect()
      })

      ws.on('error', (error) => {
        logger.error('WebSocket error:', error.message)
        // close event will fire after error, triggering reconnect
      })
    } catch (error) {
      logger.error('Failed to create WebSocket:', error)
      ws = null
      scheduleReconnect()
    }
  }

  /**
   * Schedule WebSocket reconnection
   */
  function scheduleReconnect(): void {
    if (wsReconnectTimer) {
      return
    }
    const delay = getNextReconnectDelayMs(wsReconnectAttempt)
    wsReconnectAttempt += 1
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null
      startStreaming()
    }, delay)
  }

  /**
   * Stop WebSocket connection
   */
  function stopStreaming(): void {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer)
      wsReconnectTimer = null
    }
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer)
      refreshDebounceTimer = null
    }
    if (ws) {
      ws.removeAllListeners()
      ws.close()
      ws = null
      wsConnected = false
    }
    if (streamingAbortController) {
      streamingAbortController.abort()
      streamingAbortController = null
    }
  }

  /**
   * Initialize the client
   */
  async function init(newConfig?: TogglyServerConfig): Promise<FeatureDefinitions> {
    if (newConfig) {
      config = deepMerge(config, newConfig)
      logger = createLogger(config.debug ?? false)
    }

    logger.debug('Initializing Toggly client')

    // Generate identity if not provided
    if (!config.identity) {
      config.identity = generateUUID()
      logger.debug('Generated identity:', config.identity)
    }

    // Try to load from cache first
    if (cache) {
      const cachedFeatures = await cache.getDefinitions(CACHE_KEYS.DEFINITIONS)
      if (cachedFeatures) {
        state.features = {
          ...config.featureDefaults,
          ...cachedFeatures,
        }
        logger.debug('Loaded', Object.keys(cachedFeatures).length, 'features from cache')
      }
    }

    // Fetch fresh definitions
    const features = await refresh()

    state.initialized = true

    // Start background refresh
    startRefreshInterval()

    // Start WebSocket live updates (always-on unless explicitly disabled)
    startStreaming()

    logger.debug('Toggly client initialized')

    return features
  }

  /**
   * Evaluate a single feature
   */
  async function isFeatureOn(
    featureKey: string,
    context?: EvaluationContext
  ): Promise<boolean> {
    const evalContext: EvaluationContext = {
      identity: context?.identity ?? config.identity,
      groups: context?.groups,
      traits: context?.traits,
    }

    // Execute beforeEvaluation hooks
    const hookData = await hookExecutor.executeBeforeEvaluation(
      featureKey,
      evalContext,
      config.featureDefaults?.[featureKey]
    )

    // Get feature value
    const result = state.features[featureKey] === true

    // Execute afterEvaluation hooks
    await hookExecutor.executeAfterEvaluation(featureKey, evalContext, hookData, result)

    return result
  }

  /**
   * Evaluate if a feature is off
   */
  async function isFeatureOff(
    featureKey: string,
    context?: EvaluationContext
  ): Promise<boolean> {
    const isOn = await isFeatureOn(featureKey, context)
    return !isOn
  }

  /**
   * Evaluate a feature gate with multiple features
   */
  async function evaluateFeatureGate(
    featureKeys: string[],
    requirement: FeatureRequirement = 'all',
    negate = false,
    context?: EvaluationContext
  ): Promise<boolean> {
    // Execute hooks for each feature
    for (const key of featureKeys) {
      const evalContext: EvaluationContext = {
        identity: context?.identity ?? config.identity,
        groups: context?.groups,
        traits: context?.traits,
      }

      await hookExecutor.executeBeforeEvaluation(
        key,
        evalContext,
        config.featureDefaults?.[key]
      )
    }

    const result = evaluateGate(state.features, featureKeys, requirement, negate)

    // Execute after hooks
    for (const key of featureKeys) {
      const evalContext: EvaluationContext = {
        identity: context?.identity ?? config.identity,
        groups: context?.groups,
        traits: context?.traits,
      }

      const featureResult = state.features[key] === true
      await hookExecutor.executeAfterEvaluation(key, evalContext, [], featureResult)
    }

    return result
  }

  /**
   * Set user identity
   */
  async function setIdentity(identity: string): Promise<void> {
    // Execute beforeIdentify hooks
    const hookData = await hookExecutor.executeBeforeIdentify(identity)

    config.identity = identity

    // Execute afterIdentify hooks
    await hookExecutor.executeAfterIdentify(identity, hookData)

    // Refresh with new identity
    await refresh()
  }

  /**
   * Add a hook
   */
  function addHook(hook: Hook): void {
    hookExecutor.addHook(hook)
  }

  /**
   * Remove a hook by name
   */
  function removeHook(name: string): boolean {
    return hookExecutor.removeHook(name)
  }

  /**
   * Close the client and cleanup
   */
  function close(): void {
    stopRefreshInterval()
    stopStreaming()
    hookExecutor.clear()
    logger.debug('Toggly client closed')
  }

  // Build and return client
  return {
    get state(): TogglyState {
      return { ...state, wsConnected }
    },
    get config(): TogglyServerConfig {
      return { ...config }
    },
    get identity(): string | undefined {
      return config.identity
    },
    set identity(value: string | undefined) {
      if (value) {
        setIdentity(value).catch((error) => {
          logger.error('Failed to set identity:', error)
        })
      }
    },
    init,
    refresh,
    isFeatureOn,
    isFeatureOff,
    evaluateFeatureGate,
    setIdentity,
    addHook,
    removeHook,
    close,
  }
}

// Singleton instance for convenience
let defaultClient: TogglyClient | null = null

/**
 * Initialize the default Toggly client
 */
export async function initToggly(
  config: TogglyServerConfig
): Promise<TogglyClient> {
  if (defaultClient) {
    defaultClient.close()
  }

  defaultClient = createTogglyClient(config)
  await defaultClient.init()

  return defaultClient
}

/**
 * Get the default Toggly client
 */
export function getToggly(): TogglyClient | null {
  return defaultClient
}

/**
 * Get the default client or throw if not initialized
 */
export function useToggly(): TogglyClient {
  if (!defaultClient) {
    throw new Error(
      'Toggly client not initialized. Call initToggly() first.'
    )
  }
  return defaultClient
}

/**
 * Close the default client
 */
export function closeToggly(): void {
  if (defaultClient) {
    defaultClient.close()
    defaultClient = null
  }
}
