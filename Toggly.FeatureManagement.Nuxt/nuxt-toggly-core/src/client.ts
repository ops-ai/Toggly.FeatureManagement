import type {
  TogglyConfig,
  TogglyClient,
  TogglyState,
  FeatureDefinitions,
  FeatureRequirement,
  Hook,
  FeatureDefinitionsResponse,
  EvaluationSeriesData,
} from './types'
import { HookExecutor } from './hooks'
import { DEFAULT_CONFIG, API_ENDPOINTS } from './constants'
import { generateUUID, evaluateGate, deepMerge } from './utils'

/**
 * Create a new Toggly client instance
 */
export function createTogglyClient(
  initialConfig: TogglyConfig = {}
): TogglyClient {
  const hookExecutor = new HookExecutor()
  let refreshIntervalId: ReturnType<typeof setInterval> | null = null
  let destroyed = false

  // WebSocket live updates
  let ws: WebSocket | null = null
  let wsConnected = false
  let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
  let lastFallbackRefresh = 0
  const FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000
  const WS_RECONNECT_DELAY = 5000

  // Merge with defaults while preserving a deep merge for featureDefaults.
  const config: Required<
    Pick<
      TogglyConfig,
      'baseUri' | 'environment' | 'refreshInterval' | 'showFeatureDuringEvaluation'
    >
  > &
    TogglyConfig = {
    ...DEFAULT_CONFIG,
    ...initialConfig,
    featureDefaults: deepMerge(
      {},
      initialConfig.featureDefaults ?? {}
    ) as FeatureDefinitions,
  }

  // Initialize state
  const state: TogglyState = {
    initialized: false,
    loading: false,
    features: { ...config.featureDefaults },
    error: null,
    lastRefresh: null,
  }

  // Register initial hooks
  if (config.hooks) {
    for (const hook of config.hooks) {
      hookExecutor.addHook(hook)
    }
  }

  /**
   * Fetch feature definitions from the API
   */
  async function fetchDefinitions(): Promise<FeatureDefinitions> {
    if (!config.appKey) {
      console.warn('[Toggly] No appKey provided, using defaults only')
      return { ...config.featureDefaults }
    }

    const url = API_ENDPOINTS.definitions(
      config.baseUri,
      config.appKey,
      config.environment
    )

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (config.identity) {
      headers['x-toggly-identity'] = config.identity
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = (await response.json()) as
        | FeatureDefinitionsResponse
        | Array<{ featureKey: string; filters?: Array<{ name?: string }> }>
        | { defs?: FeatureDefinitions }

      const definitions: FeatureDefinitions = {}
      if (Array.isArray(data)) {
        for (const definition of data) {
          definitions[definition.featureKey] = !!definition.filters?.some((filter) => filter.name === 'AlwaysOn')
        }
      } else if ('defs' in data && data.defs) {
        Object.assign(definitions, data.defs)
      } else if ('features' in data && Array.isArray(data.features)) {
        for (const feature of data.features) {
          definitions[feature.featureKey] = feature.enabled
        }
      }

      return definitions
    } catch (error) {
      console.error('[Toggly] Failed to fetch feature definitions:', error)
      throw error
    }
  }

  /**
   * Build the WebSocket URL from the configured base URI
   */
  function buildWebSocketUrl(): string {
    const base = config.baseUri
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')
      .replace(/\/$/, '')
    return `${base}/${config.appKey}/ws`
  }

  /**
   * Start WebSocket connection for live flag updates (browser only)
   */
  function startWebSocket(): void {
    if (typeof WebSocket === 'undefined') return
    if (!config.appKey) return
    if (!config.enableLiveUpdates) return
    if (ws) return

    try {
      const url = buildWebSocketUrl()
      ws = new WebSocket(url)

      ws.onopen = () => {
        wsConnected = true
        lastFallbackRefresh = Date.now()
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'ping') return
          if (data.type === 'flags-updated' || data.type === 'update') {
            client.refresh().catch(() => {
              // Error already logged in refresh()
            })
          }
        } catch {
          // Ignore malformed messages
        }
      }

      ws.onclose = () => {
        wsConnected = false
        ws = null
        if (!destroyed) {
          wsReconnectTimer = setTimeout(() => {
            wsReconnectTimer = null
            startWebSocket()
          }, WS_RECONNECT_DELAY)
        }
      }

      ws.onerror = (event) => {
        console.error('[Toggly] WebSocket error:', event)
      }
    } catch (error) {
      console.error('[Toggly] Failed to create WebSocket:', error)
    }
  }

  /**
   * Stop WebSocket connection and cancel any pending reconnect
   */
  function stopWebSocket(): void {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer)
      wsReconnectTimer = null
    }
    if (ws) {
      ws.onclose = null
      ws.close()
      ws = null
    }
    wsConnected = false
  }

  /**
   * Start the auto-refresh interval
   */
  function startRefreshInterval(): void {
    if (refreshIntervalId || config.refreshInterval <= 0) {
      return
    }

    refreshIntervalId = setInterval(async () => {
      if (!destroyed) {
        // When WebSocket is connected, only do fallback refresh every 20 minutes
        if (wsConnected) {
          const now = Date.now()
          if (now - lastFallbackRefresh < FALLBACK_REFRESH_INTERVAL) {
            return
          }
          lastFallbackRefresh = now
        }

        try {
          await client.refresh()
        } catch {
          // Error already logged in refresh()
        }
      }
    }, config.refreshInterval)
  }

  /**
   * Stop the auto-refresh interval
   */
  function stopRefreshInterval(): void {
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId)
      refreshIntervalId = null
    }
  }

  const client: TogglyClient = {
    get state() {
      return { ...state }
    },

    get config() {
      return { ...config }
    },

    get identity() {
      return config.identity
    },

    set identity(value: string | undefined) {
      config.identity = value
    },

    async init(newConfig?: TogglyConfig): Promise<FeatureDefinitions> {
      if (destroyed) {
        throw new Error('[Toggly] Client has been destroyed')
      }

      // Merge new config if provided
      if (newConfig) {
        Object.assign(config, newConfig)
      }

      // Generate identity if not provided
      if (!config.identity) {
        config.identity = generateUUID()
      }

      state.loading = true
      state.error = null

      try {
        const definitions = await fetchDefinitions()

        // Merge with defaults (API takes precedence)
        state.features = {
          ...config.featureDefaults,
          ...definitions,
        }
        state.lastRefresh = new Date()
        state.initialized = true

        // Execute afterRefresh hooks
        await hookExecutor.executeAfterRefresh(state.features)

        // Start auto-refresh
        startRefreshInterval()

        // Start WebSocket for live updates
        startWebSocket()

        return state.features
      } catch (error) {
        state.error = error as Error

        // Fall back to defaults
        state.features = { ...config.featureDefaults }
        state.initialized = true

        return state.features
      } finally {
        state.loading = false
      }
    },

    async refresh(): Promise<FeatureDefinitions> {
      if (destroyed) {
        throw new Error('[Toggly] Client has been destroyed')
      }

      state.loading = true
      state.error = null

      try {
        const definitions = await fetchDefinitions()

        state.features = {
          ...config.featureDefaults,
          ...definitions,
        }
        state.lastRefresh = new Date()

        // Execute afterRefresh hooks
        await hookExecutor.executeAfterRefresh(state.features)

        return state.features
      } catch (error) {
        state.error = error as Error
        throw error
      } finally {
        state.loading = false
      }
    },

    async isFeatureOn(featureKey: string): Promise<boolean> {
      if (destroyed) {
        return config.featureDefaults?.[featureKey] ?? false
      }

      // Execute before hooks
      const dataMap = await hookExecutor.executeBeforeEvaluation(
        featureKey,
        config.featureDefaults?.[featureKey]
      )

      const result = state.features[featureKey] === true

      // Execute after hooks (fire-and-forget)
      hookExecutor.executeAfterEvaluation(featureKey, dataMap, result).catch(() => {
        // Errors already logged in hook executor
      })

      return result
    },

    async isFeatureOff(featureKey: string): Promise<boolean> {
      const isOn = await client.isFeatureOn(featureKey)
      return !isOn
    },

    async evaluateFeatureGate(
      featureKeys: string[],
      requirement: FeatureRequirement = 'all',
      negate: boolean = false
    ): Promise<boolean> {
      if (destroyed) {
        return evaluateGate(
          config.featureDefaults ?? {},
          featureKeys,
          requirement,
          negate
        )
      }

      // Execute before hooks for each key
      const dataMaps: Array<{
        key: string
        dataMap: Map<string, void | EvaluationSeriesData>
      }> = []

      for (const key of featureKeys) {
        const dataMap = await hookExecutor.executeBeforeEvaluation(
          key,
          config.featureDefaults?.[key]
        )
        dataMaps.push({ key, dataMap })
      }

      const result = evaluateGate(state.features, featureKeys, requirement, negate)

      // Execute after hooks for each key (fire-and-forget)
      for (const { key, dataMap } of dataMaps) {
        const keyResult = state.features[key] === true
        hookExecutor
          .executeAfterEvaluation(key, dataMap, keyResult)
          .catch(() => {
            // Errors already logged
          })
      }

      return result
    },

    async setIdentity(identity: string): Promise<void> {
      if (destroyed) {
        return
      }

      // Execute before hooks
      const dataMap = await hookExecutor.executeBeforeIdentify(identity)

      config.identity = identity

      // Execute after hooks
      await hookExecutor.executeAfterIdentify(identity, dataMap)

      // Refresh with new identity
      if (state.initialized) {
        await client.refresh()
      }
    },

    addHook(hook: Hook): void {
      hookExecutor.addHook(hook)
    },

    removeHook(name: string): boolean {
      return hookExecutor.removeHook(name)
    },

    destroy(): void {
      destroyed = true
      stopWebSocket()
      stopRefreshInterval()
      hookExecutor.clearHooks()
    },
  }

  return client
}
