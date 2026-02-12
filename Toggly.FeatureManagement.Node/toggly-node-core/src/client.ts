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

  // Streaming event source (for SSE)
  let streamingAbortController: AbortController | null = null

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

    let url = `${baseUrl}/${appKey}-${environment}/defs`

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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add identity header if set
    if (config.identity) {
      headers['x-toggly-identity'] = config.identity
    }

    // Add ETag for conditional requests
    if (config.useEtag && state.etag) {
      headers['If-None-Match'] = state.etag
    }

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

      // Handle 304 Not Modified
      if (response.status === 304) {
        logger.debug('Definitions unchanged (304)')
        return state.features
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Store ETag if present
      const etag = response.headers.get('etag')
      if (etag) {
        state.etag = etag
        if (cache) {
          await cache.setEtag(CACHE_KEYS.ETAG, etag)
        }
      }

      const data = (await response.json()) as FeatureDefinitionsResponse

      // Transform array response to record
      const features: FeatureDefinitions = {}
      if (data.features && Array.isArray(data.features)) {
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
   * Start SSE streaming for real-time updates
   */
  async function startStreaming(): Promise<void> {
    if (!config.enableStreaming || !config.streamingUrl) {
      return
    }

    streamingAbortController = new AbortController()

    try {
      // Note: Node.js doesn't have native EventSource
      // This is a placeholder for SSE implementation
      // In production, use a library like 'eventsource' or 'undici'
      logger.debug('Streaming not yet implemented for Node.js')
    } catch (error) {
      logger.error('Failed to start streaming:', error)
    }
  }

  /**
   * Stop SSE streaming
   */
  function stopStreaming(): void {
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
      const cachedEtag = await cache.getEtag(CACHE_KEYS.ETAG)
      if (cachedEtag) {
        state.etag = cachedEtag
      }

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

    // Start streaming if enabled
    if (config.enableStreaming) {
      await startStreaming()
    }

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
      return { ...state }
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
