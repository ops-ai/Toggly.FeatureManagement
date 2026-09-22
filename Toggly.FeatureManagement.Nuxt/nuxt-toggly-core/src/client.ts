import { createBrowserSnapshots } from './browser-snapshots'
import type {
  TogglyConfig,
  TogglyClient,
  TogglyState,
  FeatureDefinitions,
  FeatureRequirement,
  Hook,
  EvaluationSeriesData,
  EvalContextArg,
  EvalContextOverrides,
  FrontendTelemetryRuntime,
  TrustedTelemetryRuntime,
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
  indexDefinitions,
  parseDefinitionsPayload,
  snapshotEvaluatedBooleans,
  type EvalContext,
  type FeatureDefinitionModel,
} from '@ops-ai/toggly-eval'
import { buildDefinitionFetchHeaders } from './sdk-identity'
import { parseRemoteEvaluatedPayload } from './parse-evaluated-payload'
import { parseEvaluatedResponseBody, readResponseBody } from './signed-response'

/**
 * Create a new Toggly client instance
 */
export function createTogglyClient(
  initialConfig: TogglyConfig = {}
): TogglyClient {
  const hookExecutor = new HookExecutor()
  const frontend = Boolean(initialConfig.frontendTelemetryFactory)
  let generation = 0
  let refreshOperation = 0
  let refreshIntervalId: ReturnType<typeof setInterval> | null = null
  let destroyed = false
  let telemetry: TrustedTelemetryRuntime | null = null
  let frontendTelemetry: FrontendTelemetryRuntime | null = null
  let frontendTelemetrySignature: string | null = null
  let frontendTelemetryFetch: TogglyConfig['telemetryFetch']
  let frontendTelemetryFactory: TogglyConfig['frontendTelemetryFactory']
  /** True while a refresh is in flight — concurrent callers skip without counting. */
  let refreshInFlight = false

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
  let hasHydratedEvaluatedSnapshot = false
  const featuresRefreshListeners = new Set<() => void>()

  const snapshots = createBrowserSnapshots(config)
  let activeScope = snapshots.scope()
  let hasSnapshot = false
  function restoreSnapshot() {
    hasSnapshot = false
    cachedDefinitionsRevision = null
    pendingDefinitionsPin = null
    state.features = {...config.featureDefaults}
    state.definitions = new Map()
    const cached = snapshots.restore()
    if (cached) {
      state.features = {...cached.features}
      state.definitions = indexDefinitions(cached.definitions)
      cachedDefinitionsRevision = cached.revision
      hasSnapshot = true
    }
  }
  function saveSnapshot() {
    if (!frontend) return
    hasSnapshot = true
    snapshots.save({features:{...state.features}, definitions:[...state.definitions.values()], revision:cachedDefinitionsRevision})
  }
  function transitionContext(loading = false) {
    generation++
    state.loading = loading
    refreshInFlight = false
    stopWebSocket(); stopRefreshInterval()
    if (activeScope !== snapshots.scope()) {activeScope = snapshots.scope(); restoreSnapshot()}
    frontendTelemetry?.setContext?.(config)
    notifyFeaturesRefresh()
  }
  function assertCurrent(expected: number) {
    if (frontend && (destroyed || expected !== generation)) throw Error('[Toggly] Superseded browser operation')
  }
  if (frontend) restoreSnapshot()

  function reportError(message: string, error?: unknown): void {
    config.onError?.(message, error)
  }

  function recordDefinitionCacheHit(): void {
    try {
      telemetry?.recordDefinitionCacheHit()
    } catch (error) {
      console.debug('[Toggly] Failed to record definition cache hit:', error)
    }
  }

  function recordDefinitionCacheMiss(): void {
    try {
      telemetry?.recordDefinitionCacheMiss()
    } catch (error) {
      console.debug('[Toggly] Failed to record definition cache miss:', error)
    }
  }

  function normalizeRevision(revision: string | null | undefined): string | null {
    if (!revision) {
      return null
    }
    return revision.replace(/^"+|"+$/g, '')
  }

  function revisionsMatch(
    previous: string | null | undefined,
    incoming: string | null | undefined,
  ): boolean {
    const a = normalizeRevision(previous)
    const b = normalizeRevision(incoming)
    if (!a || !b) {
      return false
    }
    return a === b
  }

  function getDefinitionsRevision(): string | null {
    return cachedDefinitionsRevision
  }

  function cacheDefinitionsRevision(revision: string | null | undefined): void {
    if (!revision) {
      return
    }
    cachedDefinitionsRevision = normalizeRevision(revision)
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
    const expected = generation
    const operation = refreshOperation
    for (const listener of featuresRefreshListeners) {
      if (frontend && (destroyed || expected !== generation || operation !== refreshOperation)) return
      try {
        listener()
      } catch (error) {
        console.error('[Toggly] Feature refresh listener error:', error)
      }
    }
  }

  function discardHydratedSnapshotForIdentity(identity: string | undefined): void {
    if (hasHydratedEvaluatedSnapshot && identity !== config.identity) {
      state.features = { ...config.featureDefaults }
      hasHydratedEvaluatedSnapshot = false
      notifyFeaturesRefresh()
    }
  }

  function isLocalEvaluation(): boolean {
    return (config.evaluationMode ?? DEFAULT_CONFIG.evaluationMode) === 'local'
  }

  function buildEvalContext(
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
    overrides?: EvalContextArg,
    owner = config,
  ): EvalContext {
    const o: EvalContextOverrides =
      typeof overrides === 'string' ? { identity: overrides } : overrides ?? {}
    return {
      identity: o.identity ?? owner.identity,
      groups: o.groups ?? owner.groups,
      traits: o.claims ?? owner.claims,
      claims: o.claims ?? owner.claims,
      request: o.request,
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
      claims: config.claims,
    })
    state.features = {
      ...config.featureDefaults,
      ...snapshot,
    }
    return state.features
  }

  function captureEvaluation(keys: string[]) {
    const runtime = frontendTelemetry
    return {
      // Response data is JSON; copy selected nested gates/filters before callbacks.
      features: JSON.parse(JSON.stringify(Object.fromEntries(keys.map(key => [key,state.features[key]])))) as FeatureDefinitions,
      definitions: new Map(JSON.parse(JSON.stringify(keys.filter(key => state.definitions.has(key)).map(key => [key,state.definitions.get(key)]))) as [string,FeatureDefinitionModel][]),
      local: isLocalEvaluation(), owner: {...config, groups: config.groups ? [...config.groups] : undefined, claims: {...config.claims}},
      gates: localGates.map(gate => ({...gate, flagKeys: [...gate.flagKeys]})), index: new Map(localGateIndex),
      record: runtime?.captureCheck?.() ?? (runtime?.usageEnabled ? runtime.recordCheck.bind(runtime) : undefined),
    }
  }
  type CapturedEvaluation = ReturnType<typeof captureEvaluation>

  function evaluateLocalFeature(
    featureKey: string,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
    overrides?: EvalContextArg,
    captured?: CapturedEvaluation,
  ): boolean {
    const definitions = captured?.definitions ?? state.definitions
    if (definitions.has(featureKey)) {
      return evaluateDefinitions(
        definitions,
        featureKey,
        buildEvalContext(entityContext, overrides, captured?.owner),
      )
    }
    return (captured?.owner ?? config).featureDefaults?.[featureKey] ?? false
  }

  function getEffectiveFlag(
    featureKey: string,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
    overrides?: EvalContextArg,
    captured?: CapturedEvaluation,
  ): boolean {
    if (captured?.local ?? isLocalEvaluation()) {
      const evaluated = evaluateLocalFeature(
        featureKey,
        entityContext,
        overrides,
        captured,
      )
      return applyLocalGate(evaluated, featureKey, captured?.gates ?? localGates, captured?.index ?? localGateIndex)
    }
    const remote = resolveEvaluatedDefinition((captured?.features ?? state.features)[featureKey], entityContext)
    return applyLocalGate(remote, featureKey, captured?.gates ?? localGates, captured?.index ?? localGateIndex)
  }

  /**
   * Evaluate a feature and record a usage check once (when enabled).
   * Shared by isFeatureOn and evaluateFeatureGate so gates inherit recording
   * without double-counting on the gate path beyond one check per key.
   */
  function evaluateAndRecordCheck(
    featureKey: string,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
    overrides?: EvalContextArg,
    captured?: CapturedEvaluation,
  ): boolean {
    const result = getEffectiveFlag(featureKey, entityContext, overrides, captured)
    if (captured) { captured.record?.(featureKey, result ? 'enabled' : 'disabled'); return result }
    if (frontendTelemetry?.usageEnabled) {
      frontendTelemetry.recordCheck(featureKey, result ? 'enabled' : 'disabled')
    } else if (telemetry?.usageEnabled) {
      const o: EvalContextOverrides =
        typeof overrides === 'string' ? { identity: overrides } : overrides ?? {}
      const identity = o.identity ?? config.identity
      telemetry.recordCheck(featureKey, result, identity)
    }
    return result
  }

  function startTelemetry(): void {
    if (config.frontendTelemetryFactory) {
      const signature = JSON.stringify([
        config.metricsBaseUrl,
        config.telemetryFlushIntervalMs,
        config.enableTelemetry,
        config.enableUsageTracking,
        config.enableMetrics,
      ])
      if (frontendTelemetry && frontendTelemetrySignature === signature && frontendTelemetryFetch === config.telemetryFetch && frontendTelemetryFactory === config.frontendTelemetryFactory) {frontendTelemetry.setContext?.(config); return}
      frontendTelemetry?.dispose({flush: false})
      frontendTelemetry = null
      frontendTelemetrySignature = signature
      frontendTelemetryFetch = config.telemetryFetch
      frontendTelemetryFactory = config.frontendTelemetryFactory
      if (!config.appKey || config.enableTelemetry === false ||
          (config.enableUsageTracking === false && config.enableMetrics === false)) return
      frontendTelemetry = config.frontendTelemetryFactory(config)
      return
    }
    if (!config.appKey || !config.trustedTelemetryFactory) {
      return
    }
    if (!config.enableUsageTracking && !config.enableMetrics) {
      return
    }
    if (telemetry) {
      void telemetry.close()
      telemetry = null
    }
    telemetry = config.trustedTelemetryFactory(config)
    telemetry?.start()
  }

  /**
   * Fetch feature definitions from the API.
   * Returns whether this attempt applied a new revision (miss) or reused cache (hit).
   */
  async function fetchDefinitions(): Promise<'hit' | 'miss'> {
    const expected = generation
    if (!config.appKey) {
      console.warn('[Toggly] No appKey provided, using defaults only')
      return 'hit'
    }

    const local = isLocalEvaluation()
    const endpoint = local
      ? API_ENDPOINTS.definitionsSigned
      : API_ENDPOINTS.evaluatedSigned
    // Frontend base queries are independent of the definitions pathname.
    // Keep trusted endpoint construction on its existing compatibility path.
    const fetchUrl = frontend ? new URL(config.baseUri) : new URL(
      endpoint(config.baseUri, config.appKey, config.environment)
    )
    if (frontend) {
      // Only the current context owns the token; a configured URL cannot revive it.
      fetchUrl.searchParams.delete('i')
      fetchUrl.pathname = `${fetchUrl.pathname.replace(/\/$/, '')}/${local ? 'definitions-signed' : 'evaluated-signed'}/${config.appKey}/${config.environment}`
    }
    if (frontend && config.instanceId?.trim()) {
      for (const key of [...fetchUrl.searchParams.keys()]) {
        if (['i', 'u', 'userId', 'g'].includes(key) || key.startsWith('claim.')) fetchUrl.searchParams.delete(key)
      }
      fetchUrl.searchParams.set('i', config.instanceId.trim())
    }
    else if (!local) {
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

    // Pin forces a cache-proof GET; do not treat prior etag as still current.
    const previousRevision = pin ? null : getDefinitionsRevision()
    const headers = buildDefinitionFetchHeaders({
      'Content-Type': 'application/json',
      ...(!(frontend && config.instanceId?.trim()) && config.identity ? { 'x-toggly-identity': config.identity } : {}),
      ...(previousRevision ? { 'If-None-Match': previousRevision } : {}),
    })

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })

      assertCurrent(expected)
      const responseRevision = normalizeRevision(extractDefinitionsRevision(response))

      if (response.status === 304) {
        if (frontend && !hasSnapshot) throw Error('[Toggly] 304 without a matching snapshot')
        if (responseRevision) {
          cacheDefinitionsRevision(responseRevision)
        }
        saveSnapshot()
        return 'hit'
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Always parse/apply the body on HTTP 200. Equal revision is still a cache
      // hit (definition revision unchanged), but remote evaluated payloads can
      // differ by identity for the same revision — skipping the body would leave
      // defaults / stale evaluated flags.
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

      assertCurrent(expected)
      if (local) {
        applyLocalDefinitions(parseDefinitionsPayload(parsed))
      } else {
        state.definitions = new Map()
        state.features = {
          ...config.featureDefaults,
          ...parseRemoteEvaluatedPayload(parsed, {
            verifySignatures: config.verifySignatures,
          }),
        }
      }

      if (frontend) cachedDefinitionsRevision = responseRevision
      else if (responseRevision) cacheDefinitionsRevision(responseRevision)
      saveSnapshot()
      // Same revision → hit (CDN replay / identity-scoped re-eval); new → miss.
      return revisionsMatch(previousRevision, responseRevision) ? 'hit' : 'miss'
    } catch (error) {
      assertCurrent(expected)
      console.error('[Toggly] Failed to fetch feature definitions:', error)
      reportError('Error fetching feature flags', error)
      throw error
    }
  }

  /**
   * Shared definition refresh with single-flight + one hit/miss outcome.
   * Returns whether this call performed the fetch (false = concurrent skip).
   */
  async function refreshFeatures(options?: {
    reportRefreshError?: boolean
  }): Promise<{ features: FeatureDefinitions; performed: boolean }> {
    const expected = generation
    const reportRefreshError = options?.reportRefreshError ?? true

    // Concurrent refresh skipped (in flight) — do not count.
    if (refreshInFlight) {
      return { features: state.features, performed: false }
    }

    refreshInFlight = true
    state.loading = true
    state.error = null
    let outcomeRecorded = false

    try {
      const outcome = await fetchDefinitions()
      if (frontend && (destroyed || expected !== generation)) return {features: state.features, performed:false}
      if (outcome === 'miss') {
        recordDefinitionCacheMiss()
      } else {
        recordDefinitionCacheHit()
      }
      outcomeRecorded = true
      state.lastRefresh = new Date()
      return { features: state.features, performed: true }
    } catch (error) {
      if (frontend && (destroyed || expected !== generation)) return {features:state.features, performed:false}
      state.error = error as Error
      if (reportRefreshError) {
        reportError('Error refreshing feature flags', error)
      }

      // Network error keeping last-good definitions only — not featureDefaults alone.
      if (
        !outcomeRecorded &&
        (state.definitions.size > 0 || state.lastRefresh != null)
      ) {
        recordDefinitionCacheHit()
      }

      throw error
    } finally {
      if (!frontend || expected === generation) {
        if (!frontend) state.loading = false
        refreshInFlight = false
      }
    }
  }

  /**
   * Start the auto-refresh interval
   */
  function startRefreshInterval(): void {
    if ((frontend && typeof window === 'undefined') || destroyed || refreshIntervalId || config.refreshInterval <= 0) {
      return
    }

    refreshIntervalId = setInterval(async () => {
      if (!destroyed) {
        // When WebSocket is connected, only do fallback refreshes at a longer interval.
        // Skipped poll (live WS / in-memory still valid) counts as a cache hit.
        if (wsConnected) {
          const now = Date.now()
          if (now - lastFallbackRefresh < FALLBACK_REFRESH_INTERVAL) {
            recordDefinitionCacheHit()
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
      (frontend && typeof window === 'undefined') || destroyed ||
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

  type ContextUpdate = Parameters<TogglyClient['setContext']>[0]

  function hasTargetingChanges(update: ContextUpdate): boolean {
    const groupKey = (groups?: string[]) => JSON.stringify([...(groups ?? [])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0))
    const groupsChanged = update.groups !== undefined && groupKey(update.groups) !== groupKey(config.groups)
    const claimsChanged = update.claims !== undefined && (
      Object.keys(update.claims).length !== Object.keys(config.claims ?? {}).length ||
      Object.entries(update.claims).some(([key, value]) => config.claims?.[key] !== value)
    )
    return groupsChanged || claimsChanged
  }

  function isUnchangedBrowserContext(update: ContextUpdate, targetingChanged: boolean): boolean {
    // Explicit identity retains its existing hooks and token-clearing semantics.
    // Identical token/group/claim updates cannot recursively notify evaluation hooks.
    if (update.identity !== undefined || targetingChanged) return false
    return update.instanceId === undefined || (update.instanceId.trim() || undefined) === (config.instanceId?.trim() || undefined)
  }

  function applyTrustedContext(update: ContextUpdate, targetingChanged: boolean): 'identify' | 'refresh' | undefined {
    if (update.groups !== undefined) config.groups = update.groups
    if (update.claims !== undefined) config.claims = update.claims
    if (update.identity !== undefined && update.identity !== config.identity) return 'identify'
    if (!state.initialized || !targetingChanged) return
    if (!isLocalEvaluation()) return 'refresh'
    applyLocalDefinitions(state.definitions)
    notifyFeaturesRefresh()
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
      discardHydratedSnapshotForIdentity(value)
      config.identity = value
      if (frontend) {config.instanceId = undefined; transitionContext(); if (state.initialized) {startRefreshInterval(); startWebSocket()}}
    },

    async init(newConfig?: TogglyConfig): Promise<FeatureDefinitions> {
      if (destroyed) {
        throw new Error('[Toggly] Client has been destroyed')
      }

      const expected = frontend ? ++generation : generation
      const operation = ++refreshOperation
      const current = () => !frontend || (!destroyed && expected === generation && operation === refreshOperation)
      if (frontend) {stopWebSocket(); stopRefreshInterval(); refreshInFlight = false}
      // Merge new config if provided
      if (newConfig) {
        if ('identity' in newConfig) discardHydratedSnapshotForIdentity(newConfig.identity)
        if (frontend && newConfig.identity !== undefined && newConfig.instanceId === undefined) config.instanceId = undefined
        Object.assign(config, newConfig)
      }

      // Generate identity if not provided
      if (!config.identity) {
        config.identity = generateUUID()
      }

      if (frontend) {
        config.instanceId = config.instanceId?.trim() || undefined
        if (activeScope !== snapshots.scope()) {activeScope = snapshots.scope(); restoreSnapshot()}
      }
      state.loading = true
      state.error = null

      try {
        // Start usage/metrics before first refresh so snapshot + refresh outcomes are recorded.
        startTelemetry()

        // Startup served from durable snapshot (hydrateDefinitions) before network — cache hit.
        if (state.definitions.size > 0) {
          recordDefinitionCacheHit()
        }

        try {
          await refreshFeatures({ reportRefreshError: false })
          if (!current()) return state.features
        } catch {
          if (!current()) return state.features
          // Preserve last-known-good / defaults; refreshFeatures already recorded a hit when applicable.
          if (
            state.definitions.size === 0 &&
            Object.keys(state.features).length === 0
          ) {
            state.features = { ...config.featureDefaults }
          }
          state.initialized = true
          return state.features
        }

        state.initialized = true

        if (destroyed || !current()) return state.features

        // Execute afterRefresh hooks
        await hookExecutor.executeAfterRefresh(state.features, current)
        if (destroyed || !current()) return state.features
        if (frontend) state.loading = false
        notifyFeaturesRefresh()

        // Start auto-refresh
        startRefreshInterval()

        // Start WebSocket for live updates (browser + Node server)
        startWebSocket()

        return state.features
      } catch (error) {
        if (!current()) return state.features
        state.error = error as Error

        if (
          state.definitions.size > 0 ||
          Object.keys(state.features).length > 0
        ) {
          state.initialized = true
          return state.features
        }

        state.features = { ...config.featureDefaults }
        state.initialized = true

        return state.features
      } finally {
        if (current()) {state.loading = false; hasHydratedEvaluatedSnapshot = false}
      }
    },

    async refresh(): Promise<FeatureDefinitions> {
      if (destroyed) {
        throw new Error('[Toggly] Client has been destroyed')
      }

      if (frontend && refreshInFlight) return state.features
      const expected = generation
      const operation = ++refreshOperation
      const current = () => !frontend || (!destroyed && expected === generation && operation === refreshOperation)
      try {
        const { features, performed } = await refreshFeatures()
        if (performed) {
          // Execute afterRefresh hooks
          await hookExecutor.executeAfterRefresh(state.features, current)
          if (!current()) return state.features
          if (frontend) state.loading = false
          notifyFeaturesRefresh()
        }
        return frontend ? state.features : features
      } finally {
        // Only admitted current work settles loading; a skipped call owns nothing.
        if (frontend && current()) state.loading = false
      }
    },

    async isFeatureOn(
      featureKey: string,
      context?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
      overrides?: EvalContextArg,
    ): Promise<boolean> {
      if (destroyed) {
        return config.featureDefaults?.[featureKey] ?? false
      }

      const captured = frontend ? captureEvaluation([featureKey]) : undefined
      const entityContext = normalizeEntityContext(context, kind)

      // Execute before hooks
      const dataMap = await hookExecutor.executeBeforeEvaluation(
        featureKey,
        (captured?.owner ?? config).featureDefaults?.[featureKey]
      )

      const result = evaluateAndRecordCheck(featureKey, entityContext, overrides, captured)

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
      overrides?: EvalContextArg,
    ): Promise<boolean> {
      const isOn = await client.isFeatureOn(
        featureKey,
        context,
        kind,
        overrides,
      )
      return !isOn
    },

    async evaluateFeatureGate(
      featureKeys: string[],
      requirement: FeatureRequirement = 'all',
      negate: boolean = false,
      context?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
      overrides?: EvalContextArg,
    ): Promise<boolean> {
      if (destroyed) {
        return evaluateGate(
          config.featureDefaults ?? {},
          featureKeys,
          requirement,
          negate,
        )
      }

      const selectedKeys = frontend ? [...featureKeys] : featureKeys
      const captured = frontend ? captureEvaluation(selectedKeys) : undefined
      const entityContext = normalizeEntityContext(context, kind)

      if (!frontend) {
        const dataMaps = []
        for (const key of featureKeys) {
          dataMaps.push({key, dataMap: await hookExecutor.executeBeforeEvaluation(key, config.featureDefaults?.[key])})
        }
        const checks = featureKeys.map(key => evaluateAndRecordCheck(key, entityContext, overrides))
        const result = featureKeys.length === 0 ? true : requirement === 'any' ? checks.some(Boolean) : checks.every(Boolean)
        for (const {key, dataMap} of dataMaps) {
          const keyResult = getEffectiveFlag(key, entityContext, overrides)
          hookExecutor.executeAfterEvaluation(key, dataMap, keyResult).catch(() => {})
        }
        return negate ? !result : result
      }
      if (selectedKeys.length === 0) return !negate
      let result = requirement !== 'any'
      for (const key of selectedKeys) {
        const dataMap = await hookExecutor.executeBeforeEvaluation(
          key,
          (captured?.owner ?? config).featureDefaults?.[key],
        )
        const keyResult = evaluateAndRecordCheck(key, entityContext, overrides, captured)
        hookExecutor.executeAfterEvaluation(key, dataMap, keyResult).catch(() => {})
        if (requirement === 'any' ? keyResult : !keyResult) {
          result = requirement === 'any'
          break
        }
      }
      return negate ? !result : result
    },

    registerContext<T>(
      kind: string,
      mapper: (entity: T) => import('@ops-ai/toggly-hooks-types').TogglyEntityContext,
    ): void {
      registerEntityContext(kind, mapper)
    },

    async setIdentity(identity: string): Promise<void> {
      if (frontend) return client.setContext({identity})
      if (destroyed) {
        return
      }

      const previousIdentity = config.identity
      const previousFeatures = { ...state.features }

      // Execute before hooks
      const dataMap = await hookExecutor.executeBeforeIdentify(identity)

      if (!state.initialized) {
        discardHydratedSnapshotForIdentity(identity)
        config.identity = identity
        await hookExecutor.executeAfterIdentify(identity, dataMap)
        return
      }

      // Local: re-snapshot with the new identity (no remote refresh).
      if (isLocalEvaluation()) {
        config.identity = identity
        await hookExecutor.executeAfterIdentify(identity, dataMap)
        applyLocalDefinitions(state.definitions)
        notifyFeaturesRefresh()
        return
      }

      // Remote: withhold prior enables before publishing the new identity.
      state.features = { ...config.featureDefaults }
      notifyFeaturesRefresh()

      config.identity = identity
      await hookExecutor.executeAfterIdentify(identity, dataMap)

      try {
        await client.refresh()
      } catch (error) {
        config.identity = previousIdentity
        state.features = previousFeatures
        notifyFeaturesRefresh()
        throw error
      }
    },

    async setContext(update): Promise<void> {
      if (destroyed) return
      const targetingChanged = hasTargetingChanges(update)
      if (frontend && isUnchangedBrowserContext(update, targetingChanged)) return
      if (!frontend) {
        const action = applyTrustedContext(update, targetingChanged)
        if (action === 'identify') await client.setIdentity(update.identity!)
        else if (action === 'refresh') await client.refresh()
        return
      }
      const expected = ++generation
      const operation = ++refreshOperation
      let installed = expected
      state.loading = true
      try {
        const hooks = update.identity !== undefined ? await hookExecutor.executeBeforeIdentify(update.identity) : undefined
        if (destroyed || expected !== generation || operation !== refreshOperation) return
        const localDefinitions = isLocalEvaluation() && !config.instanceId && !update.instanceId ? state.definitions : undefined
        if (update.identity !== undefined) {config.identity = update.identity; if (update.instanceId === undefined) config.instanceId = undefined}
        if (update.instanceId !== undefined) config.instanceId = update.instanceId.trim() || undefined
        if (update.groups !== undefined) config.groups = update.groups
        if (update.claims !== undefined) config.claims = update.claims
        transitionContext(true)
        installed = generation
        if (localDefinitions?.size) {applyLocalDefinitions(localDefinitions); cachedDefinitionsRevision = null; saveSnapshot(); notifyFeaturesRefresh()}
        if (hooks) await hookExecutor.executeAfterIdentify(update.identity!, hooks)
        if (destroyed || installed !== generation || operation !== refreshOperation) return
        if (state.initialized) try {
          if (!isLocalEvaluation() || !localDefinitions?.size) await client.refresh()
        } finally {if (!destroyed && installed === generation) {startRefreshInterval(); startWebSocket()}}
      } finally {
        if (!destroyed && installed === generation && operation === refreshOperation) state.loading = false
      }
    },

    hydrateEvaluatedFeatures(features: Record<string, boolean>): FeatureDefinitions {
      if (destroyed) return { ...state.features }
      if (isLocalEvaluation()) {
        throw new Error('[Toggly] Evaluated snapshot hydration requires remote evaluation mode')
      }
      if (Object.values(features).some(value => typeof value !== 'boolean')) {
        throw new TypeError('[Toggly] Evaluated snapshots must contain only booleans')
      }
      // Current state only: never promote another identity's snapshot to defaults.
      state.features = { ...features }
      hasHydratedEvaluatedSnapshot = true
      if (frontend) {cachedDefinitionsRevision = null; saveSnapshot()}
      notifyFeaturesRefresh()
      return { ...state.features }
    },

    getDefinitions(): Map<string, FeatureDefinitionModel> {
      return state.definitions
    },

    /**
     * Apply a cached definitions-signed payload without fetching.
     * Used by server packages for last-known-good hydration.
     */
    hydrateDefinitions(defs: FeatureDefinitionModel[]): FeatureDefinitions {
      if (destroyed) {
        return state.features
      }
      const features = applyLocalDefinitions(indexDefinitions(defs))
      // Durable snapshot apply after telemetry is running (e.g. last-known-good
      // recovery). Startup hydrate-before-init is counted in init() instead.
      if (state.initialized && defs.length > 0) {
        recordDefinitionCacheHit()
      }
      return features
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

    recordUsage(featureKey: string, identity?: string, variant?: string): void {
      if (frontendTelemetry?.usageEnabled) frontendTelemetry.recordUsage(featureKey, variant)
      else telemetry?.recordUsage(featureKey, identity ?? config.identity, variant)
    },

    recordView(featureKey: string, identity?: string, variant?: string): void {
      if (frontendTelemetry?.usageEnabled) frontendTelemetry.recordView(featureKey, variant)
      else telemetry?.recordView(featureKey, identity ?? config.identity, variant)
    },

    measure(
      metricKey: string,
      value: number,
      options?: { feature?: string; variant?: string },
    ): void {
      if (frontendTelemetry) frontendTelemetry.unsupported('measure')
      else telemetry?.measure(metricKey, value, options)
    },

    incrementCounter(
      metricKey: string,
      value = 1,
      options?: { feature?: string; variant?: string },
    ): void {
      if (frontendTelemetry?.metricsEnabled) frontendTelemetry.incrementCounter(metricKey, value)
      else telemetry?.incrementCounter(metricKey, value, options)
    },

    setGauge(metricKey: string, value: number): void {
      frontendTelemetry?.metricsEnabled && frontendTelemetry.setGauge(metricKey, value)
    },

    observe(
      metricKey: string,
      value: number,
      options?: { feature?: string; variant?: string },
    ): void {
      if (frontendTelemetry) frontendTelemetry.unsupported('observe')
      else telemetry?.observe(metricKey, value, options)
    },

    async flushTelemetry(): Promise<void> {
      if (frontendTelemetry) await frontendTelemetry.flush()
      else await telemetry?.flushAll()
    },

    destroy(options?: {flush?: boolean}): void {
      destroyed = true
      if (frontend) state.loading = false
      generation++
      stopWebSocket()
      stopRefreshInterval()
      hookExecutor.clearHooks()
      featuresRefreshListeners.clear()
      localGatesListeners.clear()
      if (telemetry) {
        void telemetry.close()
        telemetry = null
      }
      frontendTelemetry?.dispose(options)
      frontendTelemetry = null
      frontendTelemetrySignature = null
    },
  }

  return client
}
