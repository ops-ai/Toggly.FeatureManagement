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
import { generateUUID, evaluateGate, isBrowser } from './utils'
import {
  applyLocalGate,
  buildFlagGateIndex,
  type FlagGateIndex,
  type LocalGate,
} from '@ops-ai/toggly-local-gates'

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

  // Merge with defaults
  const config: Required<
    Pick<
      TogglyConfig,
      'baseUri' | 'environment' | 'refreshInterval' | 'showFeatureDuringEvaluation'
    >
  > &
    TogglyConfig = {
      baseUri: initialConfig.baseUri ?? DEFAULT_CONFIG.baseUri,
      environment: initialConfig.environment ?? DEFAULT_CONFIG.environment,
      refreshInterval: initialConfig.refreshInterval ?? DEFAULT_CONFIG.refreshInterval,
      showFeatureDuringEvaluation: initialConfig.showFeatureDuringEvaluation ?? DEFAULT_CONFIG.showFeatureDuringEvaluation,
      featureDefaults: initialConfig.featureDefaults ?? {},
      ...initialConfig,
    }

  // Initialize state
  const state: TogglyState = {
    initialized: false,
    loading: false,
    features: { ...config.featureDefaults },
    error: null,
    lastRefresh: null,
    wsConnected: false,
  }

  // Register initial hooks
  if (config.hooks) {
    for (const hook of config.hooks) {
      hookExecutor.addHook(hook)
    }
  }

  let localGates: LocalGate[] = config.localGates ?? []
  let localGateIndex: FlagGateIndex = buildFlagGateIndex(localGates)
  const localGatesListeners = new Set<() => void>()

  function getEffectiveFlag(featureKey: string): boolean {
    return applyLocalGate(
      state.features[featureKey] === true,
      featureKey,
      localGates,
      localGateIndex,
    )
  }

  function evaluateGateEffective(
    featureKeys: string[],
    requirement: FeatureRequirement = 'all',
    negate = false,
  ): boolean {
    if (featureKeys.length === 0) {
      return !negate
    }

    let result: boolean
    if (requirement === 'any') {
      result = featureKeys.some((key) => getEffectiveFlag(key))
    } else {
      result = featureKeys.every((key) => getEffectiveFlag(key))
    }

    return negate ? !result : result
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
   * Start the auto-refresh interval
   */
  function startRefreshInterval(): void {
    if (refreshIntervalId || config.refreshInterval <= 0) {
      return
    }

    refreshIntervalId = setInterval(async () => {
      if (!destroyed) {
        // When WebSocket is connected, only do fallback refreshes at a longer interval
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
   * Build the WebSocket URL from the base URI
   */
  function buildWebSocketUrl(): string {
    const wsScheme = config.baseUri.replace(/^https?/, (m) =>
      m === 'https' ? 'wss' : 'ws'
    )
    const base = wsScheme.replace(/\/+$/, '')
    return `${base}/${config.appKey}/ws`
  }

  /**
   * Start a WebSocket connection for live feature flag updates (browser only)
   */
  function startWebSocket(): void {
    if (!isBrowser() || !config.appKey || config.enableLiveUpdates === false) {
      return
    }

    // Clean up any existing connection
    stopWebSocket()

    try {
      const url = buildWebSocketUrl()
      ws = new WebSocket(url)

      ws.onopen = () => {
        wsConnected = true
        state.wsConnected = true
      }

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
          const messageType = data?.type ?? data?.event

          if (messageType === 'flags-updated' || messageType === 'update') {
            client.refresh().catch(() => {
              // Error already logged in refresh()
            })
          }
        } catch {
          // If the message isn't JSON, treat any message as a refresh signal
          client.refresh().catch(() => {
            // Error already logged in refresh()
          })
        }
      }

      ws.onclose = () => {
        wsConnected = false
        state.wsConnected = false
        ws = null

        // Schedule reconnect if not destroyed
        if (!destroyed && config.enableLiveUpdates !== false) {
          wsReconnectTimer = setTimeout(() => {
            wsReconnectTimer = null
            startWebSocket()
          }, WS_RECONNECT_DELAY)
        }
      }

      ws.onerror = () => {
        // onclose will fire after onerror, which handles reconnect
        wsConnected = false
        state.wsConnected = false
      }
    } catch (error) {
      console.error('[Toggly] Failed to create WebSocket connection:', error)
      wsConnected = false
      state.wsConnected = false
    }
  }

  /**
   * Stop the WebSocket connection and cancel any pending reconnect
   */
  function stopWebSocket(): void {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer)
      wsReconnectTimer = null
    }

    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
      ws.close()
      ws = null
    }

    wsConnected = false
    state.wsConnected = false
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

        // Start WebSocket for live updates (browser only)
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

      const result = getEffectiveFlag(featureKey)

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
        dataMap: Map<string, EvaluationSeriesData | void>
      }> = []

      for (const key of featureKeys) {
        const dataMap = await hookExecutor.executeBeforeEvaluation(
          key,
          config.featureDefaults?.[key]
        )
        dataMaps.push({ key, dataMap })
      }

      const result = evaluateGateEffective(featureKeys, requirement, negate)

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

    setLocalGates(gates: LocalGate[]): void {
      localGates = [...gates]
      localGateIndex = buildFlagGateIndex(localGates)
    },

    notifyLocalGatesChanged(): void {
      localGatesListeners.forEach((listener) => {
        try {
          listener()
        } catch (error) {
          console.error('[Toggly] Local gate listener error:', error)
        }
      })
    },

    subscribeLocalGatesChanged(listener: () => void): () => void {
      localGatesListeners.add(listener)
      return () => {
        localGatesListeners.delete(listener)
      }
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
