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
  appendDefinitionsRevisionParam,
  applyFlagsUpdatedPlan,
  planFlagsUpdatedRefresh,
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
import {
  evaluateDefinitions,
  parseDefinitionsPayload,
  snapshotEvaluatedBooleans,
  type EvalContext,
  type FeatureDefinitionModel,
} from '@ops-ai/toggly-eval'
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
  let pendingDefinitionsPin: string | null = null
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
      | 'evaluationMode'
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
      evaluationMode: initialConfig.evaluationMode ?? DEFAULT_CONFIG.evaluationMode,
      featureDefaults: initialConfig.featureDefaults ?? {},
    }

  // Initialize state
  const state: TogglyState = {
    initialized: false,
    loading: false,
    features: { ...config.featureDefaults },
    definitions: new Map(),
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
    applyFlagsUpdatedPlan(
      planFlagsUpdatedRefresh(message, getDefinitionsRevision()),
      message,
      {
        refreshJwks: () => scheduleDebouncedRefresh(true),
        refreshPinned: (pin) => {
          pendingDefinitionsPin = pin
          scheduleDebouncedRefresh(true)
        },
        cacheEtagIfPresent: (etag) => cacheDefinitionsRevision(etag),
      },
    )
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

  function isLocalEvaluation(): boolean {
    return (config.evaluationMode ?? DEFAULT_CONFIG.evaluationMode) === 'local'
  }

  function buildEvalContext(
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
  ): EvalContext {
    return {
      identity: config.identity,
      groups: config.groups,
      traits: config.claims,
      entity: entityContext ?? null,
    }
  }

  function applyLocalDefinitions(
    defs: Map<string, FeatureDefinitionModel>,
  ): FeatureDefinitions {
    state.definitions = defs
    const snapshot = snapshotEvaluatedBooleans(defs, {
      identity: config.identity,
      groups: config.groups,
      traits: config.claims,
    })
    return {
      ...config.featureDefaults,
      ...snapshot,
    }
  }

  function evaluateLocalFeature(
    featureKey: string,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
  ): boolean {
    if (state.definitions.has(featureKey)) {
      return evaluateDefinitions(
        state.definitions,
        featureKey,
        buildEvalContext(entityContext),
      )
    }
    return config.featureDefaults?.[featureKey] ?? false
  }

  function getEffectiveFlag(
    featureKey: string,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
  ): boolean {
    if (isLocalEvaluation()) {
      const evaluated = evaluateLocalFeature(featureKey, entityContext)
      return applyLocalGate(evaluated, featureKey, localGates, localGateIndex)
    }
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

    const local = isLocalEvaluation()
    const endpoint = local
      ? API_ENDPOINTS.definitionsSigned
      : API_ENDPOINTS.evaluatedSigned
    const fetchUrl = new URL(
      endpoint(config.baseUri, config.appKey, config.environment)
    )
    if (!local) {
      appendEvaluationContext(
        fetchUrl,
        {
          identity: config.identity,
          groups: config.groups,
          claims: config.claims,
        },
        'evaluated',
      )
    }
    const pin = pendingDefinitionsPin
    pendingDefinitionsPin = null
    const url = appendDefinitionsRevisionParam(fetchUrl.toString(), pin)

    const revision = pin ? null : getDefinitionsRevision()
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

      if (local) {
        return applyLocalDefinitions(parseDefinitionsPayload(parsed))
      }

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

      state.definitions = new Map()
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

      // Remote rail: identity is baked into evaluated-signed fetch — refresh.
      // Local rail: identity is eval-time only — do not re-fetch definitions.
      if (state.initialized && !isLocalEvaluation()) {
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
