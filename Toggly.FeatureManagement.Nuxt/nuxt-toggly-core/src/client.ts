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
import { generateUUID, evaluateGate, isEdgeRuntime } from './utils'
import {
  applyLocalGate,
  buildFlagGateIndex,
  type FlagGateIndex,
  type LocalGate,
} from '@ops-ai/toggly-local-gates'
import {
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  REFRESH_DEBOUNCE_MS,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  shouldFetchOnSync,
  type WsSyncMessage,
} from './ws-sync'
import {
  dispatchLiveMessage,
  openLiveSocket,
  resolveWebSocketConstructor,
  type LiveSocket,
} from './live-socket'
import { appendEvaluationContext, normalizeEntityContext, registerContext as registerEntityContext, resolveEvaluatedDefinition } from '@ops-ai/toggly-hooks-types'
import { buildDefinitionFetchHeaders } from './sdk-identity'
import { parseEvaluatedResponseBody, readResponseBody } from './signed-response'

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
  let liveSocket: LiveSocket | null = null
  let wsConnected = false
  let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
  let wsReconnectAttempt = 0
  let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let cachedDefinitionsRevision: string | null = null
  let lastFallbackRefresh = 0
  const FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000

  // Merge with defaults (normalize after spread so explicit undefined cannot wipe defaults)
  const config: Required<
    Pick<
      TogglyConfig,
      | 'baseUri'
      | 'environment'
      | 'refreshInterval'
      | 'showFeatureDuringEvaluation'
      | 'enableLiveUpdates'
    >
  > &
    TogglyConfig = {
      ...initialConfig,
      baseUri: initialConfig.baseUri ?? DEFAULT_CONFIG.baseUri,
      environment: initialConfig.environment ?? DEFAULT_CONFIG.environment,
      refreshInterval: initialConfig.refreshInterval ?? DEFAULT_CONFIG.refreshInterval,
      showFeatureDuringEvaluation:
        initialConfig.showFeatureDuringEvaluation ?? DEFAULT_CONFIG.showFeatureDuringEvaluation,
      enableLiveUpdates: initialConfig.enableLiveUpdates ?? DEFAULT_CONFIG.enableLiveUpdates,
      featureDefaults: initialConfig.featureDefaults ?? {},
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
  const featuresRefreshListeners = new Set<() => void>()

  function reportError(message: string, error?: unknown): void {
    config.onError?.(message, error)
  }

  function getDefinitionsRevision(): string | null {
    return cachedDefinitionsRevision
  }

  function cacheDefinitionsRevision(revision: string | null | undefined): void {
    if (!revision) {
      return
    }
    cachedDefinitionsRevision = revision.replace(/^"+|"+$/g, '')
  }

  function scheduleDebouncedRefresh(forceRevisionReset = false): void {
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer)
    }
    refreshDebounceTimer = setTimeout(() => {
      refreshDebounceTimer = null
      if (forceRevisionReset) {
        cachedDefinitionsRevision = null
      }
      client.refresh().catch(() => {
        // Error already logged in refresh()
      })
    }, REFRESH_DEBOUNCE_MS)
  }

  function handleWsSyncMessage(message: WsSyncMessage): void {
    const previousRevision = getDefinitionsRevision()
    if (shouldFetchOnSync(message, previousRevision)) {
      // Do not cache message.etag before refresh — that would make the
      // follow-up GET send If-None-Match for the new revision and 304 with
      // stale in-memory defs.
      scheduleDebouncedRefresh()
      return
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
      // Clear revision so the GET is unconditional. Caching the WS etag
      // before fetch caused 304 responses and left flags stale.
      scheduleDebouncedRefresh(true)
      return
    }
    if (message.etag) {
      cacheDefinitionsRevision(message.etag)
    }
  }

  function notifyFeaturesRefresh(): void {
    featuresRefreshListeners.forEach((listener) => {
      try {
        listener()
      } catch (error) {
        console.error('[Toggly] Feature refresh listener error:', error)
      }
    })
  }

  function getEffectiveFlag(
    featureKey: string,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
  ): boolean {
    const remote = resolveEvaluatedDefinition(state.features[featureKey], entityContext)
    return applyLocalGate(remote, featureKey, localGates, localGateIndex)
  }

  function evaluateGateEffective(
    featureKeys: string[],
    requirement: FeatureRequirement = 'all',
    negate = false,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
  ): boolean {
    if (featureKeys.length === 0) {
      return !negate
    }

    let result: boolean
    if (requirement === 'any') {
      result = featureKeys.some((key) => getEffectiveFlag(key, entityContext))
    } else {
      result = featureKeys.every((key) => getEffectiveFlag(key, entityContext))
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

    const fetchUrl = new URL(
      API_ENDPOINTS.definitions(
        config.baseUri,
        config.appKey,
        config.environment
      )
    )
    appendEvaluationContext(
      fetchUrl,
      {
        identity: config.identity,
        groups: config.groups,
        claims: config.claims,
      },
      'evaluated',
    )
    const url = fetchUrl.toString()

    const revision = getDefinitionsRevision()
    const headers = buildDefinitionFetchHeaders({
      'Content-Type': 'application/json',
      ...(config.identity ? { 'x-toggly-identity': config.identity } : {}),
      ...(revision ? { 'If-None-Match': revision } : {}),
    })

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })

      const responseRevision = extractDefinitionsRevision(response)
      if (responseRevision) {
        cacheDefinitionsRevision(responseRevision)
      }

      if (response.status === 304) {
        return { ...state.features }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const bodyText = await readResponseBody(response)
      const parsed = await parseEvaluatedResponseBody(bodyText, {
        verifySignatures: config.verifySignatures,
        baseUri: config.baseUri,
        allowedKeyIds: config.allowedKeyIds,
        maxSignatureAgeSeconds: config.maxSignatureAgeSeconds,
        headers: buildDefinitionFetchHeaders({
          'Content-Type': 'application/json',
        }),
      })

      const definitions: FeatureDefinitions = {}
      if (config.verifySignatures) {
        const data = parsed as
          | FeatureDefinitions
          | Array<{ featureKey: string; filters?: Array<{ name?: string }> }>
        if (Array.isArray(data)) {
          for (const definition of data) {
            definitions[definition.featureKey] = !!definition.filters?.some(
              (filter) => filter.name === 'AlwaysOn'
            )
          }
        } else if (data && typeof data === 'object') {
          Object.assign(definitions, data)
        }
      } else {
        const data = parsed as
          | FeatureDefinitionsResponse
          | Array<{ featureKey: string; filters?: Array<{ name?: string }> }>
        if (Array.isArray(data)) {
          for (const definition of data) {
            definitions[definition.featureKey] = !!definition.filters?.some(
              (filter) => filter.name === 'AlwaysOn'
            )
          }
        } else if ('defs' in data && data.defs) {
          Object.assign(definitions, data.defs)
        } else if ('features' in data && Array.isArray(data.features)) {
          for (const feature of data.features) {
            definitions[feature.featureKey] = feature.enabled
          }
        }
      }

      return definitions
    } catch (error) {
      console.error('[Toggly] Failed to fetch feature definitions:', error)
      reportError('Error fetching feature flags', error)
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
   * Start a WebSocket connection for live feature flag updates
   * (browser, Node with global WebSocket, or config.webSocketImpl / `ws`).
   * Skipped on Edge runtimes (no long-lived process).
   */
  function startWebSocket(): void {
    if (
      isEdgeRuntime() ||
      !config.appKey ||
      config.enableLiveUpdates === false
    ) {
      return
    }

    const WebSocketImpl = resolveWebSocketConstructor(config.webSocketImpl)
    if (!WebSocketImpl) {
      reportError(
        'WebSocket implementation not available; live updates disabled. Pass webSocketImpl (e.g. from the ws package) on Node 18.',
      )
      return
    }

    stopWebSocket()

    try {
      const url = buildWebSocketUrl(
        config.baseUri,
        config.appKey,
        getDefinitionsRevision(),
      )

      const opened = openLiveSocket(url, WebSocketImpl, {
        onOpen: () => {
          if (liveSocket !== opened) {
            return
          }
          wsConnected = true
          state.wsConnected = true
          wsReconnectAttempt = 0
          lastFallbackRefresh = Date.now()
        },
        onMessage: (data) => {
          if (liveSocket !== opened) {
            return
          }
          dispatchLiveMessage(data, {
            onPlainUpdate: () => scheduleDebouncedRefresh(),
            onSync: (message) => handleWsSyncMessage(message),
            onUpdate: (message) => handleWsUpdateMessage(message),
          })
        },
        onClose: () => {
          if (liveSocket !== opened) {
            return
          }
          wsConnected = false
          state.wsConnected = false
          liveSocket = null

          if (!destroyed && config.enableLiveUpdates !== false) {
            const delay = getNextReconnectDelayMs(wsReconnectAttempt)
            wsReconnectAttempt += 1
            wsReconnectTimer = setTimeout(() => {
              wsReconnectTimer = null
              startWebSocket()
            }, delay)
          }
        },
        onError: () => {
          if (liveSocket !== opened) {
            return
          }
          wsConnected = false
          state.wsConnected = false
        },
      })
      liveSocket = opened
    } catch (error) {
      console.error('[Toggly] Failed to create WebSocket connection:', error)
      reportError('Failed to create WebSocket connection', error)
      wsConnected = false
      state.wsConnected = false
      liveSocket = null
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

    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer)
      refreshDebounceTimer = null
    }

    if (liveSocket) {
      try {
        liveSocket.close()
      } catch {
        // ignore
      }
      liveSocket = null
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
        notifyFeaturesRefresh()

        // Start auto-refresh
        startRefreshInterval()

        // Start WebSocket for live updates (browser + Node server)
        startWebSocket()

        return state.features
      } catch (error) {
        state.error = error as Error

        if (Object.keys(state.features).length === 0) {
          state.features = { ...config.featureDefaults }
        }
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
        notifyFeaturesRefresh()

        return state.features
      } catch (error) {
        state.error = error as Error
        reportError('Error refreshing feature flags', error)
        return state.features
      } finally {
        state.loading = false
      }
    },

    async isFeatureOn(
      featureKey: string,
      context?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
    ): Promise<boolean> {
      if (destroyed) {
        return config.featureDefaults?.[featureKey] ?? false
      }

      const entityContext = normalizeEntityContext(context, kind)

      // Execute before hooks
      const dataMap = await hookExecutor.executeBeforeEvaluation(
        featureKey,
        config.featureDefaults?.[featureKey]
      )

      const result = getEffectiveFlag(featureKey, entityContext)

      // Execute after hooks (fire-and-forget)
      hookExecutor.executeAfterEvaluation(featureKey, dataMap, result).catch(() => {
        // Errors already logged in hook executor
      })

      return result
    },

    async isFeatureOff(
      featureKey: string,
      context?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
    ): Promise<boolean> {
      const isOn = await client.isFeatureOn(featureKey, context, kind)
      return !isOn
    },

    async evaluateFeatureGate(
      featureKeys: string[],
      requirement: FeatureRequirement = 'all',
      negate: boolean = false,
      context?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
    ): Promise<boolean> {
      if (destroyed) {
        return evaluateGate(
          config.featureDefaults ?? {},
          featureKeys,
          requirement,
          negate,
        )
      }

      const entityContext = normalizeEntityContext(context, kind)

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

      const result = evaluateGateEffective(featureKeys, requirement, negate, entityContext)

      // Execute after hooks for each key (fire-and-forget)
      for (const { key, dataMap } of dataMaps) {
        const keyResult = getEffectiveFlag(key, entityContext)
        hookExecutor
          .executeAfterEvaluation(key, dataMap, keyResult)
          .catch(() => {
            // Errors already logged
          })
      }

      return result
    },

    registerContext<T>(
      kind: string,
      mapper: (entity: T) => import('@ops-ai/toggly-hooks-types').TogglyEntityContext,
    ): void {
      registerEntityContext(kind, mapper)
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

    subscribeFeaturesRefresh(listener: () => void): () => void {
      featuresRefreshListeners.add(listener)
      return () => {
        featuresRefreshListeners.delete(listener)
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
