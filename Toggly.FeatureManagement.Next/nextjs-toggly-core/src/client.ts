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
import {
  appendEvaluationContext,
  normalizeEntityContext,
  registerContext as registerEntityContext,
  resolveEvaluatedDefinition,
} from '@ops-ai/toggly-hooks-types'
import { buildDefinitionFetchHeaders } from './sdk-identity'
import { parseEvaluatedResponseBody, readResponseBody } from './signed-response'
import {
  evaluateDefinitions,
  indexDefinitions,
  parseDefinitionsPayload,
  snapshotEvaluatedBooleans,
  type EvalContext,
  type FeatureDefinitionModel,
} from '@ops-ai/toggly-eval'

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

  function isLocalMode(): boolean {
    return (config.evaluationMode ?? 'remote') === 'local'
  }

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

  /**
   * definitions.toggly.io can lag the WS `flags-updated` notify. Refresh
   * immediately, then retry until the HTTP revision matches the WS etag (or
   * retries are exhausted).
   */
  const flagsUpdatedRetryTimers = new Set<ReturnType<typeof setTimeout>>()

  function clearFlagsUpdatedRetries(): void {
    for (const timer of flagsUpdatedRetryTimers) {
      clearTimeout(timer)
    }
    flagsUpdatedRetryTimers.clear()
  }

  function scheduleFlagsUpdatedRefresh(expectedEtag?: string): void {
    scheduleDebouncedRefresh(true)
    clearFlagsUpdatedRetries()
    if (!expectedEtag) {
      return
    }

    for (const delayMs of [800, 2000, 4000]) {
      const timer = setTimeout(() => {
        flagsUpdatedRetryTimers.delete(timer)
        if (destroyed) {
          return
        }
        if (getDefinitionsRevision() === expectedEtag) {
          return
        }
        pendingDefinitionsPin = expectedEtag
        cachedDefinitionsRevision = null
        client.refresh().catch(() => {
          // Error already logged in refresh()
        })
      }, delayMs)
      flagsUpdatedRetryTimers.add(timer)
    }
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
          scheduleFlagsUpdatedRefresh(pin ?? undefined)
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

  function buildEvalContext(
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
    identityOverride?: string,
  ): EvalContext {
    return {
      identity: identityOverride ?? config.identity,
      groups: config.groups,
      traits: config.claims,
      entity: entityContext ?? undefined,
    }
  }

  function applyLocalDefinitions(
    defs: Map<string, FeatureDefinitionModel>
  ): FeatureDefinitions {
    state.definitions = defs
    const snapshot = snapshotEvaluatedBooleans(defs, {
      identity: config.identity,
      groups: config.groups,
      traits: config.claims,
    })
    state.features = {
      ...config.featureDefaults,
      ...snapshot,
    }
    return state.features
  }

  function evaluateLocalFeature(
    featureKey: string,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
    identityOverride?: string,
  ): boolean {
    if (state.definitions.has(featureKey)) {
      return evaluateDefinitions(
        state.definitions,
        featureKey,
        buildEvalContext(entityContext, identityOverride),
      )
    }
    return config.featureDefaults?.[featureKey] ?? false
  }

  function getEffectiveFlag(
    featureKey: string,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
    identityOverride?: string,
  ): boolean {
    const remote = isLocalMode()
      ? evaluateLocalFeature(featureKey, entityContext, identityOverride)
      : resolveEvaluatedDefinition(state.features[featureKey], entityContext)
    return applyLocalGate(remote, featureKey, localGates, localGateIndex)
  }

  function evaluateGateEffective(
    featureKeys: string[],
    requirement: FeatureRequirement = 'all',
    negate = false,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
    identityOverride?: string,
  ): boolean {
    if (featureKeys.length === 0) {
      return !negate
    }

    let result: boolean
    if (requirement === 'any') {
      result = featureKeys.some((key) =>
        getEffectiveFlag(key, entityContext, identityOverride),
      )
    } else {
      result = featureKeys.every((key) =>
        getEffectiveFlag(key, entityContext, identityOverride),
      )
    }

    return negate ? !result : result
  }

  function buildFetchHeaders(revision: string | null): Record<string, string> {
    return buildDefinitionFetchHeaders({
      'Content-Type': 'application/json',
      ...(config.identity ? { 'x-toggly-identity': config.identity } : {}),
      ...(revision ? { 'If-None-Match': revision } : {}),
    })
  }

  /**
   * Fetch evaluated-signed definitions (remote / client rail)
   */
  async function fetchRemoteEvaluated(): Promise<FeatureDefinitions> {
    if (!config.appKey) {
      console.warn('[Toggly] No appKey provided, using defaults only')
      return { ...config.featureDefaults }
    }

    const fetchUrl = new URL(
      API_ENDPOINTS.evaluatedSigned(
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
    const pin = pendingDefinitionsPin
    pendingDefinitionsPin = null
    const url = appendDefinitionsRevisionParam(fetchUrl.toString(), pin)

    const revision = pin ? null : getDefinitionsRevision()
    const headers = buildFetchHeaders(revision)

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
        // Verified path returns raw defs (map or legacy array), never envelope.defs.
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
   * Fetch definitions-signed rules (local evaluation rail — no identity query)
   */
  async function fetchLocalDefinitions(): Promise<Map<string, FeatureDefinitionModel>> {
    if (!config.appKey) {
      console.warn('[Toggly] No appKey provided, using defaults only')
      return new Map()
    }

    const pin = pendingDefinitionsPin
    pendingDefinitionsPin = null
    const baseUrl = API_ENDPOINTS.definitionsSigned(
      config.baseUri,
      config.appKey,
      config.environment
    )
    const url = appendDefinitionsRevisionParam(baseUrl, pin)
    const revision = pin ? null : getDefinitionsRevision()
    const headers = buildFetchHeaders(revision)

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
        return state.definitions
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

      return parseDefinitionsPayload(parsed)
    } catch (error) {
      console.error('[Toggly] Failed to fetch feature definitions:', error)
      reportError('Error fetching feature flags', error)
      throw error
    }
  }

  async function loadFeaturesFromApi(): Promise<FeatureDefinitions> {
    if (isLocalMode()) {
      const defs = await fetchLocalDefinitions()
      return applyLocalDefinitions(defs)
    }

    state.definitions = new Map()
    const definitions = await fetchRemoteEvaluated()
    state.features = {
      ...config.featureDefaults,
      ...definitions,
    }
    return state.features
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

    clearFlagsUpdatedRetries()

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
      return { ...state, definitions: state.definitions }
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
        await loadFeaturesFromApi()
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

        // Fall back to defaults only when no last-known-good flags exist.
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
        await loadFeaturesFromApi()
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
      identityOverride?: string,
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

      const result = getEffectiveFlag(featureKey, entityContext, identityOverride)

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
      identityOverride?: string,
    ): Promise<boolean> {
      const isOn = await client.isFeatureOn(featureKey, context, kind, identityOverride)
      return !isOn
    },

    async evaluateFeatureGate(
      featureKeys: string[],
      requirement: FeatureRequirement = 'all',
      negate: boolean = false,
      context?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
      identityOverride?: string,
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

      const result = evaluateGateEffective(
        featureKeys,
        requirement,
        negate,
        entityContext,
        identityOverride,
      )

      // Execute after hooks for each key (fire-and-forget)
      for (const { key, dataMap } of dataMaps) {
        const keyResult = getEffectiveFlag(key, entityContext, identityOverride)
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

      // Remote rail: identity is sent on fetch — refresh. Local: eval-time only.
      if (state.initialized && !isLocalMode()) {
        await client.refresh()
      }
    },

    getDefinitions(): Map<string, FeatureDefinitionModel> {
      return state.definitions
    },

    /**
     * Apply a cached (or otherwise sourced) definitions-signed payload without
     * fetching. Used by server packages to hydrate last-known-good definitions
     * after a failed init/refresh.
     */
    hydrateDefinitions(defs: FeatureDefinitionModel[]): FeatureDefinitions {
      if (destroyed) {
        return state.features
      }
      return applyLocalDefinitions(indexDefinitions(defs))
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
