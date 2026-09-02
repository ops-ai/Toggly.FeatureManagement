import type {
  TogglyClient,
  TogglyServerConfig,
  TogglyState,
  FeatureDefinitions,
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
  deepMerge,
  createLogger,
} from './utils.js'
import WebSocket from 'ws'
import {
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  REFRESH_DEBOUNCE_MS,
  appendDefinitionsRevisionParam,
  applyFlagsUpdatedPlan,
  planFlagsUpdatedRefresh,
  shouldFetchOnSync,
  type WsSyncMessage,
} from './ws-sync.js'
import { buildDefinitionFetchHeaders } from './sdk-identity.js'
import {
  parseSignedEnvelope,
  parseDefinitionsFromRaw,
  verifySignedDefinitions,
  type JwkSet,
} from './verify.js'
import {
  normalizeEntityContext,
  type TogglyEntityContext,
} from '@ops-ai/toggly-hooks-types'
import {
  evaluateDefinitions,
  evaluateFeatureGate as evaluateLocalFeatureGate,
  indexDefinitions,
  parseDefinitionsPayload,
  snapshotEvaluatedBooleans,
  type EvalContext,
  type FeatureDefinitionModel,
} from '@ops-ai/toggly-eval'
import {
  registerContext as registerEntityContext,
  registerEntityContextsAtStartup,
} from './entity-context-registration.js'

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

  // Initialize state (fresh Map — do not share INITIAL_STATE.definitions)
  const state: TogglyState = {
    ...INITIAL_STATE,
    features: { ...INITIAL_STATE.features },
    definitions: new Map(),
  }

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
  let pendingDefinitionsPin: string | null = null
  let lastFallbackRefresh = 0
  const FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000 // 20 minutes
  let cachedJwks: JwkSet | null = null
  let cachedJwksExpiry = 0
  const JWKS_TTL_MS = 60 * 60 * 1000

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

  function clearJwksCache(): void {
    cachedJwks = null
    cachedJwksExpiry = 0
  }

  async function clearPersistedJwks(): Promise<void> {
    clearJwksCache()
    if (cache) {
      // Retired signing keys must not rehydrate from durable cache after rotation.
      await cache.clear(CACHE_KEYS.JWKS)
    }
  }

  async function reportError(error: Error, context: string): Promise<void> {
    state.error = error
    await hookExecutor.executeOnError(error, context)
    try {
      await config.onError?.(error, context)
    } catch (hookError) {
      logger.error('Error in onError callback:', hookError)
    }
  }

  function buildEvalContext(
    context?: EvaluationContext,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): EvalContext {
    return {
      identity: context?.identity ?? config.identity,
      groups: context?.groups,
      traits: context?.traits,
      entity: normalizeEntityContext(entity, kind),
    }
  }

  function applyDefinitions(
    defs: Map<string, FeatureDefinitionModel>
  ): FeatureDefinitions {
    state.definitions = defs
    const snapshot = snapshotEvaluatedBooleans(defs, {
      identity: config.identity,
    })
    state.features = {
      ...config.featureDefaults,
      ...snapshot,
    }
    return state.features
  }

  function evaluateLocalFeature(
    featureKey: string,
    ctx: EvalContext,
  ): boolean {
    if (state.definitions.has(featureKey)) {
      return evaluateDefinitions(state.definitions, featureKey, ctx)
    }
    return config.featureDefaults?.[featureKey] ?? false
  }

  function evaluateLocalGate(
    featureKeys: string[],
    requirement: FeatureRequirement,
    negate: boolean,
    ctx: EvalContext,
  ): boolean {
    if (featureKeys.length === 0) {
      return !negate
    }

    // Prefer toggly-eval when every key has a stored definition (no defaults-only keys).
    const allDefined = featureKeys.every((key) => state.definitions.has(key))
    if (allDefined) {
      return evaluateLocalFeatureGate(
        state.definitions,
        featureKeys,
        requirement,
        negate,
        ctx,
      )
    }

    const check = (key: string) => evaluateLocalFeature(key, ctx)
    const result =
      requirement === 'any'
        ? featureKeys.some(check)
        : featureKeys.every(check)
    return negate ? !result : result
  }

  async function loadOrFetchJwks(force = false): Promise<JwkSet> {
    if (!force && cachedJwks && Date.now() < cachedJwksExpiry) {
      return cachedJwks
    }

    if (!force && cache) {
      const cached = await cache.getJwks(CACHE_KEYS.JWKS)
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as JwkSet & { _expiresAt?: number }
          if (!parsed._expiresAt || parsed._expiresAt >= Date.now()) {
            cachedJwks = { keys: parsed.keys ?? [] }
            cachedJwksExpiry = parsed._expiresAt ?? Date.now() + JWKS_TTL_MS
            return cachedJwks
          }
        } catch {
          // ignore corrupt cache
        }
      }
    }

    const baseUrl = (config.baseUrl ?? DEFAULT_CONFIG.baseUrl).replace(/\/$/, '')
    const url = `${baseUrl}/.well-known/jwks`
    const response = await fetch(url, {
      headers: buildDefinitionFetchHeaders({ 'Content-Type': 'application/json' }),
    })
    if (!response.ok) {
      throw new Error(`JWKS fetch failed: HTTP ${response.status}`)
    }
    const jwks = (await response.json()) as JwkSet
    cachedJwks = jwks
    cachedJwksExpiry = Date.now() + JWKS_TTL_MS
    if (cache) {
      await cache.setJwks(
        CACHE_KEYS.JWKS,
        JSON.stringify({ ...jwks, _expiresAt: cachedJwksExpiry })
      )
    }
    return jwks
  }

  function scheduleDebouncedRefresh(forceJwksRefresh = false): void {
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer)
    }
    refreshDebounceTimer = setTimeout(() => {
      refreshDebounceTimer = null
      const run = async () => {
        if (forceJwksRefresh) {
          await clearPersistedJwks()
          cachedDefinitionsRevision = null
          state.etag = null
        }
        await refresh()
      }
      run().catch((error) => {
        logger.error('WebSocket-triggered refresh failed:', error)
      })
    }, REFRESH_DEBOUNCE_MS)
  }

  function handleWsSyncMessage(message: WsSyncMessage): void {
    const previousRevision = getDefinitionsRevision()
    if (shouldFetchOnSync(message, previousRevision)) {
      // Do not cache WS etag before HTTP confirms — avoids conditional 304 with stale defs.
      scheduleDebouncedRefresh()
      return
    }
    if (message.etag) {
      cacheDefinitionsRevision(message.etag)
    }
  }

  function handleWsUpdateMessage(message: WsSyncMessage): void {
    applyFlagsUpdatedPlan(
      planFlagsUpdatedRefresh(message, getDefinitionsRevision()),
      message,
      {
        refreshJwks: () => scheduleDebouncedRefresh(true),
        refreshPinned: (pin) => {
          pendingDefinitionsPin = pin
          cachedDefinitionsRevision = null
          scheduleDebouncedRefresh()
        },
        cacheEtagIfPresent: (etag) => cacheDefinitionsRevision(etag),
      },
    )
  }

  /**
   * Build the API URL for fetching definitions (server rail — no identity query).
   */
  function buildApiUrl(): string {
    const baseUrl = config.baseUrl ?? DEFAULT_CONFIG.baseUrl
    const appKey = config.appKey
    const environment = config.environment ?? DEFAULT_CONFIG.environment

    if (!appKey) {
      throw new Error('Toggly: appKey is required for API mode')
    }

    return `${baseUrl}/definitions-signed/${appKey}/${environment}`
  }

  /**
   * Fetch raw feature definitions from definitions-signed
   */
  async function fetchDefinitions(): Promise<Map<string, FeatureDefinitionModel>> {
    if (!config.appKey) {
      logger.debug('No appKey provided, using defaults only')
      return new Map()
    }

    const pin = pendingDefinitionsPin
    pendingDefinitionsPin = null
    const url = appendDefinitionsRevisionParam(buildApiUrl(), pin)
    const revision = pin ? null : getDefinitionsRevision()
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
        return state.definitions
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const bodyText =
        typeof response.text === 'function'
          ? await response.text()
          : JSON.stringify(await response.json())

      let defsMap: Map<string, FeatureDefinitionModel>

      if (config.verifySignatures) {
        const { envelope, defsRaw } = parseSignedEnvelope(bodyText)
        const jwks = await loadOrFetchJwks()
        verifySignedDefinitions(defsRaw, envelope, jwks, config.allowedKeyIds, {
          maxSignatureAgeSeconds: config.maxSignatureAgeSeconds,
        })

        // Apply verified raw bytes — never envelope.defs from the outer parse.
        const defs = parseDefinitionsFromRaw(defsRaw)
        defsMap = parseDefinitionsPayload(defs)
      } else {
        const data = JSON.parse(bodyText) as unknown
        defsMap = parseDefinitionsPayload(data)
      }

      logger.debug('Fetched', defsMap.size, 'definitions')

      return defsMap
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

    try {
      const defs = await fetchDefinitions()
      applyDefinitions(defs)

      state.lastRefresh = Date.now()
      state.error = null

      // Cache definitions + revision
      if (cache) {
        await cache.setDefinitionModels(
          CACHE_KEYS.DEFINITIONS,
          Array.from(state.definitions.values())
        )
        const revision = getDefinitionsRevision()
        if (revision) {
          await cache.setEtag(CACHE_KEYS.ETAG, revision)
        }
      }

      // Execute afterRefresh hooks
      await hookExecutor.executeAfterRefresh(state.features)

      logger.debug('Features refreshed successfully')

      return state.features
    } catch (error) {
      const err = error as Error
      logger.error('Failed to refresh features:', err)
      await reportError(err, 'refresh')

      // Preserve last-known-good in-memory definitions first.
      if (state.definitions.size > 0 || Object.keys(state.features).length > 0) {
        logger.debug('Preserving last-known-good in-memory features')
        return state.features
      }

      // Then try durable cache
      if (cache) {
        const cachedDefs = await cache.getDefinitionModels(CACHE_KEYS.DEFINITIONS)
        if (cachedDefs) {
          logger.debug('Using cached definitions (last-known-good)')
          return applyDefinitions(indexDefinitions(cachedDefs))
        }
      }

      // Fall back to defaults only when no last-known-good flags exist.
      state.definitions = new Map()
      state.features = config.featureDefaults ?? {}
      return state.features
    } finally {
      state.loading = false
    }
  }

  /**
   * Clear in-memory features, ETag/revision, JWKS, and durable cache entries.
   */
  async function clearCache(): Promise<void> {
    state.definitions = new Map()
    state.features = { ...(config.featureDefaults ?? {}) }
    state.etag = null
    cachedDefinitionsRevision = null
    clearJwksCache()
    if (cache) {
      await cache.clearAll()
    }
    logger.debug('Cleared feature and JWKS caches')
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

    // Generate identity if not provided (used at eval time, not on fetch URL)
    if (!config.identity) {
      config.identity = generateUUID()
      logger.debug('Generated identity:', config.identity)
    }

    // Try to load from cache first
    if (cache) {
      const cachedDefs = await cache.getDefinitionModels(CACHE_KEYS.DEFINITIONS)
      if (cachedDefs) {
        applyDefinitions(indexDefinitions(cachedDefs))
        logger.debug('Loaded', cachedDefs.length, 'definitions from cache')
      }
      const cachedEtag = await cache.getEtag(CACHE_KEYS.ETAG)
      if (cachedEtag) {
        cacheDefinitionsRevision(cachedEtag)
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

    await registerEntityContextsAtStartup({
      baseUrl: config.baseUrl ?? DEFAULT_CONFIG.baseUrl,
      appKey: config.appKey ?? '',
      registerOnStartup: config.registerContextsOnStartup ?? true,
      debug: config.debug ?? false,
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
    })

    return features
  }

  /**
   * Evaluate a single feature locally from stored definitions
   */
  async function isFeatureOn(
    featureKey: string,
    context?: EvaluationContext,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean> {
    const evalContext = buildEvalContext(context, entity, kind)
    const hookContext: EvaluationContext = {
      identity: evalContext.identity,
      groups: evalContext.groups,
      traits: evalContext.traits,
    }

    // Execute beforeEvaluation hooks
    const hookData = await hookExecutor.executeBeforeEvaluation(
      featureKey,
      hookContext,
      config.featureDefaults?.[featureKey]
    )

    const result = evaluateLocalFeature(featureKey, evalContext)

    // Execute afterEvaluation hooks
    await hookExecutor.executeAfterEvaluation(featureKey, hookContext, hookData, result)

    return result
  }

  async function isFeatureOff(
    featureKey: string,
    context?: EvaluationContext,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean> {
    const isOn = await isFeatureOn(featureKey, context, entity, kind)
    return !isOn
  }

  async function evaluateFeatureGate(
    featureKeys: string[],
    requirement: FeatureRequirement = 'all',
    negate = false,
    context?: EvaluationContext,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean> {
    const evalContext = buildEvalContext(context, entity, kind)

    // Execute hooks for each feature
    for (const key of featureKeys) {
      const hookContext: EvaluationContext = {
        identity: evalContext.identity,
        groups: evalContext.groups,
        traits: evalContext.traits,
      }

      await hookExecutor.executeBeforeEvaluation(
        key,
        hookContext,
        config.featureDefaults?.[key]
      )
    }

    const result = evaluateLocalGate(featureKeys, requirement, negate, evalContext)

    // Execute after hooks
    for (const key of featureKeys) {
      const hookContext: EvaluationContext = {
        identity: evalContext.identity,
        groups: evalContext.groups,
        traits: evalContext.traits,
      }

      const featureResult = evaluateLocalFeature(key, evalContext)
      await hookExecutor.executeAfterEvaluation(key, hookContext, [], featureResult)
    }

    return result
  }

  function registerContext<T>(
    kind: string,
    mapper: (entity: T) => TogglyEntityContext,
    schema?: {
      keyProperty: string
      displayName?: string
      properties: Array<{ name: string; type: string }>
    },
  ): void {
    registerEntityContext(kind, mapper, schema)
  }

  /**
   * Set user identity (eval-time only — does not re-fetch definitions)
   */
  async function setIdentity(identity: string): Promise<void> {
    // Execute beforeIdentify hooks
    const hookData = await hookExecutor.executeBeforeIdentify(identity)

    config.identity = identity

    // Execute afterIdentify hooks
    await hookExecutor.executeAfterIdentify(identity, hookData)
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
      return { ...state, wsConnected, definitions: state.definitions }
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
    clearCache,
    isFeatureOn,
    isFeatureOff,
    evaluateFeatureGate,
    registerContext,
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
