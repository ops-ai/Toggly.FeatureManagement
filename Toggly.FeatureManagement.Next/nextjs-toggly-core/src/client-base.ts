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
  EvaluatedVariantDef,
  VariantResult,
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
  isEntityGate,
  registerContext as registerEntityContext,
  resolveEvaluatedDefinition,
} from '@ops-ai/toggly-hooks-types'
import { buildDefinitionFetchHeaders } from './sdk-identity'
import {
  parseRemoteEvaluatedPayload,
  parseRemoteEvaluatedVariantsPayload,
  variantDefsToFlags,
} from './parse-evaluated-payload'
import { parseEvaluatedResponseBody, readResponseBody } from './signed-response'
import {
  evaluateDefinitions,
  indexDefinitions,
  parseDefinitionsPayload,
  snapshotEvaluatedBooleans,
  type EvalContext,
  type FeatureDefinitionModel,
} from '@ops-ai/toggly-eval'
import type { ClientTelemetry, TelemetryPolicy } from './telemetry-policy'

/**
 * Create a new Toggly client instance
 */
export function createClient(
  initialConfig: TogglyConfig,
  policy: TelemetryPolicy
): TogglyClient {
  const hookExecutor = new HookExecutor()
  let refreshIntervalId: ReturnType<typeof setInterval> | null = null
  let destroyed = false
  let telemetry: ClientTelemetry | null = null
  let generation = 0
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
    variants: null,
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

  // Revisions are usable only with the matching response mode and targeting snapshot.
  type Snapshot = {
    features: FeatureDefinitions
    revision: string | null
    variants?: Record<string, EvaluatedVariantDef> | null
  }
  const snapshots = new Map<string, Snapshot>()
  const scopeKey = () => JSON.stringify([
    config.baseUri, config.appKey, config.environment, config.evaluationMode ?? 'remote',
    config.instanceId?.trim() ? ['i', config.instanceId.trim()] : ['u', config.identity ?? '', [...(config.groups ?? [])].sort((a, b) => {
      // Preserve the cache key's existing UTF-16 order, independent of locale.
      if (a < b) return -1
      if (a > b) return 1
      return 0
    }), Object.entries(config.claims ?? {}).sort(([a], [b]) => a.localeCompare(b))],
    // Appended (not interleaved) so existing index-based scope/identity tuple positions are unchanged.
    config.enableVariants ? 'variants' : 'evaluated',
  ])
  const storageKey = () => `${config.featuresStorageKey ?? 'toggly:features'}:v3:${encodeURIComponent(JSON.stringify([
    config.baseUri, config.appKey, config.environment, config.evaluationMode ?? 'remote',
    config.enableVariants ? 'variants' : 'evaluated',
  ]))}`
  function isValidVariantEntry(entry: unknown): entry is EvaluatedVariantDef {
    if (entry === null || typeof entry !== 'object') return false
    const value = entry as { enabled?: unknown; variant?: unknown }
    if (typeof value.enabled !== 'boolean') return false
    return value.variant === undefined || typeof value.variant === 'string'
  }
  function isValidVariantsRecord(value: unknown): value is Record<string, EvaluatedVariantDef> | null {
    if (value === null || value === undefined) return true
    if (typeof value !== 'object' || Array.isArray(value)) return false
    return Object.values(value).every(isValidVariantEntry)
  }
  function persistedSnapshots(): Map<string, Snapshot> {
    const entries = new Map<string, Snapshot>()
    if (!config.persistFeatures || typeof localStorage === 'undefined') return entries
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey()) ?? 'null')
      if (!Array.isArray(parsed)) return entries
      for (const entry of parsed.slice(-8)) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') continue
        const snapshot = entry[1]
        if (snapshot?.features && typeof snapshot.features === 'object' && !Array.isArray(snapshot.features)
          && Object.values(snapshot.features).every(value => typeof value === 'boolean' || (isEntityGate(value)
            && value.rules.every(rule => rule !== null && typeof rule === 'object'
              && typeof rule.property === 'string' && typeof rule.op === 'string' && typeof rule.value === 'string'
              && (rule.type === undefined || ['datetime', 'number', 'boolean', 'string', 'string[]'].includes(rule.type)))))
          && (snapshot.revision === null || typeof snapshot.revision === 'string')
          && isValidVariantsRecord(snapshot.variants)) entries.set(entry[0], snapshot)
      }
    } catch { /* Unavailable or corrupt storage is not a definition snapshot. */ }
    return entries
  }
  let activeScope = scopeKey()
  let hasRemoteSnapshot = false
  function restoreSnapshot(): void {
    hasRemoteSnapshot = false
    cachedDefinitionsRevision = null
    pendingDefinitionsPin = null
    state.features = {...config.featureDefaults}
    state.variants = null
    if (isLocalMode()) return
    state.definitions = new Map()
    const snapshot = snapshots.get(scopeKey()) ?? persistedSnapshots().get(scopeKey())
    if (snapshot) {
      state.features = {...config.featureDefaults, ...snapshot.features}
      state.variants = snapshot.variants ?? null
      cachedDefinitionsRevision = snapshot.revision
      hasRemoteSnapshot = true
    }
  }
  function saveSnapshot(): void {
    if (!policy.frontend || isLocalMode()) return
    hasRemoteSnapshot = true
    const snapshot: Snapshot = {
      features: {...state.features},
      revision: cachedDefinitionsRevision,
      variants: state.variants ? {...state.variants} : null,
    }
    snapshots.delete(scopeKey()); snapshots.set(scopeKey(), snapshot)
    if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!)
    if (config.persistFeatures && typeof localStorage !== 'undefined') {
      try {
        const persisted = persistedSnapshots()
        persisted.delete(scopeKey()); persisted.set(scopeKey(), snapshot)
        if (persisted.size > 8) persisted.delete(persisted.keys().next().value!)
        localStorage.setItem(storageKey(), JSON.stringify([...persisted]))
      } catch { /* Optional cache. */ }
    }
  }
  if (policy.frontend) restoreSnapshot()

  function transitionBrowserContext(): void {
    ++generation
    refreshInFlight = false
    stopWebSocket()
    stopRefreshInterval()
    const scope = scopeKey()
    if (scope !== activeScope) {
      activeScope = scope
      restoreSnapshot()
    }
    telemetry?.setContext?.(config)
    if (isLocalMode()) applyLocalDefinitions(state.definitions)
    notifyFeaturesRefresh()
  }

  function isLocalMode(): boolean {
    return (config.evaluationMode ?? 'remote') === 'local'
  }

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
    overrides?: EvalContextArg,
    ownerConfig: typeof config = config,
  ): EvalContext {
    const o: EvalContextOverrides =
      typeof overrides === 'string' ? { identity: overrides } : overrides ?? {}
    return {
      identity: o.identity ?? ownerConfig.identity,
      groups: o.groups ?? ownerConfig.groups,
      traits: o.claims ?? ownerConfig.claims,
      claims: o.claims ?? ownerConfig.claims,
      request: o.request,
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
      claims: config.claims,
    })
    state.features = {
      ...config.featureDefaults,
      ...snapshot,
    }
    return state.features
  }

  function captureEvaluation() {
    return {
      features: {...state.features},
      definitions: new Map(state.definitions),
      localMode: isLocalMode(),
      ownerConfig: {...config, featureDefaults: {...config.featureDefaults},
        groups: config.groups ? [...config.groups] : undefined, claims: {...config.claims}},
      gates: [...localGates], index: new Map(localGateIndex),
      record: ensureTelemetry()?.captureCheck?.(),
    }
  }
  type EvaluationSnapshot = ReturnType<typeof captureEvaluation>

  function evaluateLocalFeature(
    featureKey: string,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
    overrides?: EvalContextArg,
    snapshot?: EvaluationSnapshot,
  ): boolean {
    const definitions = snapshot?.definitions ?? state.definitions
    const ownerConfig = snapshot?.ownerConfig ?? config
    if (definitions.has(featureKey)) {
      return evaluateDefinitions(
        definitions,
        featureKey,
        buildEvalContext(entityContext, overrides, ownerConfig),
      )
    }
    return ownerConfig.featureDefaults?.[featureKey] ?? false
  }

  function getEffectiveFlag(
    featureKey: string,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
    overrides?: EvalContextArg,
    snapshot?: EvaluationSnapshot,
  ): boolean {
    const remote = (snapshot?.localMode ?? isLocalMode())
      ? evaluateLocalFeature(featureKey, entityContext, overrides, snapshot)
      : resolveEvaluatedDefinition((snapshot?.features ?? state.features)[featureKey], entityContext)
    return applyLocalGate(remote, featureKey, snapshot?.gates ?? localGates, snapshot?.index ?? localGateIndex)
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
    snapshot?: EvaluationSnapshot,
  ): boolean {
    if (policy.frontend) ensureTelemetry()
    const captured = snapshot ? snapshot.record : telemetry?.captureCheck?.()
    const result = getEffectiveFlag(featureKey, entityContext, overrides, snapshot)
    if (captured) { captured(featureKey, result); return result }
    if (snapshot) return result
    if (telemetry?.usageEnabled) {
      const o: EvalContextOverrides =
        typeof overrides === 'string' ? { identity: overrides } : overrides ?? {}
      const identity = o.identity ?? config.identity
      telemetry.recordCheck(featureKey, result, identity)
    }
    return result
  }

  function evaluateGateEffective(
    featureKeys: string[],
    requirement: FeatureRequirement = 'all',
    negate = false,
    entityContext?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
    overrides?: EvalContextArg,
  ): boolean {
    if (featureKeys.length === 0) {
      return !negate
    }

    // Record once per key (same as node-core), then combine.
    const checks = featureKeys.map((key) =>
      evaluateAndRecordCheck(key, entityContext, overrides),
    )

    let result: boolean
    if (requirement === 'any') {
      result = checks.some(Boolean)
    } else {
      result = checks.every(Boolean)
    }

    return negate ? !result : result
  }

  function startTelemetry(): void {
    const next = policy.create(config)
    if (!next && !policy.frontend) return
    if (telemetry) void telemetry.close()
    telemetry = next
    telemetry?.start()
  }

  function ensureTelemetry(): ClientTelemetry | null {
    if (!destroyed && policy.frontend && !telemetry) startTelemetry()
    return destroyed ? null : telemetry
  }

  function assertCurrent(expected: number): void {
    if (policy.frontend && (destroyed || expected !== generation)) throw new Error('[Toggly] Superseded client operation')
  }

  function buildFetchHeaders(revision: string | null): Record<string, string> {
    return buildDefinitionFetchHeaders({
      'Content-Type': 'application/json',
      ...(!config.instanceId?.trim() && config.identity ? { 'x-toggly-identity': config.identity } : {}),
      ...(revision ? { 'If-None-Match': revision } : {}),
    })
  }

  function frontendDefinitionsUrl(mode: 'evaluated' | 'definitions' | 'evaluated-variants'): URL {
    const url = new URL(config.baseUri)
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${mode}-signed/${config.appKey}/${config.environment}`
    url.searchParams.delete('i')
    const instanceId = config.instanceId?.trim()
    if (instanceId) {
      for (const key of [...url.searchParams.keys()]) {
        if (key === 'u' || key === 'userId' || key === 'g' || key.startsWith('claim.')) url.searchParams.delete(key)
      }
      url.searchParams.set('i', instanceId)
    }
    return url
  }

  /**
   * Fetch evaluated-signed definitions (remote / client rail).
   * Returns defs plus whether this attempt applied a new revision (miss) or reused cache (hit).
   */
  async function fetchRemoteEvaluated(): Promise<{
    defs: FeatureDefinitions
    outcome: 'hit' | 'miss'
    /** Present (possibly null) only when `enableVariants` is set. */
    variants?: Record<string, EvaluatedVariantDef> | null
  }> {
    if (!config.appKey) {
      console.warn('[Toggly] No appKey provided, using defaults only')
      return { defs: { ...config.featureDefaults }, outcome: 'hit', variants: null }
    }

    const useVariants = !!config.enableVariants
    const expected = generation
    const fetchUrl = policy.frontend ? frontendDefinitionsUrl(useVariants ? 'evaluated-variants' : 'evaluated') : new URL(
      useVariants
        ? API_ENDPOINTS.evaluatedVariantsSigned(
            config.baseUri,
            config.appKey,
            config.environment
          )
        : API_ENDPOINTS.evaluatedSigned(
            config.baseUri,
            config.appKey,
            config.environment
          )
    )
    if (config.instanceId?.trim()) fetchUrl.searchParams.set('i', config.instanceId.trim())
    else appendEvaluationContext(
      fetchUrl,
      {
        identity: config.identity,
        groups: config.groups,
        claims: config.claims,
      },
      useVariants ? 'variants' : 'evaluated',
    )
    const pin = pendingDefinitionsPin
    pendingDefinitionsPin = null
    const url = appendDefinitionsRevisionParam(fetchUrl.toString(), pin)

    // Pin forces a cache-proof GET; do not treat prior etag as still current.
    const previousRevision = pin || (policy.frontend && !isLocalMode() && !hasRemoteSnapshot) ? null : getDefinitionsRevision()
    const headers = buildFetchHeaders(previousRevision)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })

      assertCurrent(expected)
      const responseRevision = normalizeRevision(extractDefinitionsRevision(response))

      if (response.status === 304) {
        if (policy.frontend && !isLocalMode() && !hasRemoteSnapshot) throw new Error('[Toggly] Definitions returned 304 without a matching snapshot')
        if (responseRevision) {
          cacheDefinitionsRevision(responseRevision)
        }
        return { defs: { ...state.features }, outcome: 'hit', variants: useVariants ? state.variants : null }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // HTTP 200 whose revision matches existing (CDN replay) — cache hit.
      if (revisionsMatch(previousRevision, responseRevision)) {
        if (responseRevision) {
          cacheDefinitionsRevision(responseRevision)
        }
        return { defs: { ...state.features }, outcome: 'hit', variants: useVariants ? state.variants : null }
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

      assertCurrent(expected)
      if (useVariants) {
        const variantDefs = parseRemoteEvaluatedVariantsPayload(parsed)
        if (responseRevision) {
          cacheDefinitionsRevision(responseRevision)
        }
        return { defs: variantDefsToFlags(variantDefs), outcome: 'miss', variants: variantDefs }
      }
      const defs = parseRemoteEvaluatedPayload(parsed, {
        verifySignatures: config.verifySignatures,
      })
      if (responseRevision) {
        cacheDefinitionsRevision(responseRevision)
      }
      return { defs, outcome: 'miss', variants: null }
    } catch (error) {
      assertCurrent(expected)
      console.error('[Toggly] Failed to fetch feature definitions:', error)
      reportError('Error fetching feature flags', error)
      throw error
    }
  }

  /**
   * Fetch definitions-signed rules (local evaluation rail — no identity query).
   * Returns defs plus whether this attempt applied a new revision (miss) or reused cache (hit).
   */
  async function fetchLocalDefinitions(): Promise<{
    defs: Map<string, FeatureDefinitionModel>
    outcome: 'hit' | 'miss'
  }> {
    if (!config.appKey) {
      console.warn('[Toggly] No appKey provided, using defaults only')
      return { defs: new Map(), outcome: 'hit' }
    }

    const expected = generation
    const pin = pendingDefinitionsPin
    pendingDefinitionsPin = null
    const baseUrl = policy.frontend ? frontendDefinitionsUrl('definitions').toString() : API_ENDPOINTS.definitionsSigned(
      config.baseUri,
      config.appKey,
      config.environment
    )
    const url = appendDefinitionsRevisionParam(baseUrl, pin)
    const previousRevision = pin || (policy.frontend && !isLocalMode() && !hasRemoteSnapshot) ? null : getDefinitionsRevision()
    const headers = buildFetchHeaders(previousRevision)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })

      assertCurrent(expected)
      const responseRevision = normalizeRevision(extractDefinitionsRevision(response))

      if (response.status === 304) {
        if (policy.frontend && !isLocalMode() && !hasRemoteSnapshot) throw new Error('[Toggly] Definitions returned 304 without a matching snapshot')
        if (responseRevision) {
          cacheDefinitionsRevision(responseRevision)
        }
        return { defs: state.definitions, outcome: 'hit' }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      if (revisionsMatch(previousRevision, responseRevision)) {
        if (responseRevision) {
          cacheDefinitionsRevision(responseRevision)
        }
        return { defs: state.definitions, outcome: 'hit' }
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

      assertCurrent(expected)
      const defs = parseDefinitionsPayload(parsed)
      if (responseRevision) {
        cacheDefinitionsRevision(responseRevision)
      }
      return { defs, outcome: 'miss' }
    } catch (error) {
      assertCurrent(expected)
      console.error('[Toggly] Failed to fetch feature definitions:', error)
      reportError('Error fetching feature flags', error)
      throw error
    }
  }

  async function loadFeaturesFromApi(): Promise<'hit' | 'miss'> {
    const expected = generation
    if (isLocalMode()) {
      const { defs, outcome } = await fetchLocalDefinitions()
      assertCurrent(expected)
      if (outcome === 'miss') {
        applyLocalDefinitions(defs)
      }
      return outcome
    }

    const { defs, outcome, variants } = await fetchRemoteEvaluated()
    assertCurrent(expected)
    if (outcome === 'miss') {
      state.definitions = new Map()
      state.features = {
        ...config.featureDefaults,
        ...defs,
      }
      state.variants = config.enableVariants ? (variants ?? null) : null
      saveSnapshot()
    }
    return outcome
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
      const outcome = await loadFeaturesFromApi()
      if (policy.frontend && (destroyed || expected !== generation)) return { features: state.features, performed: false }
      if (outcome === 'miss') {
        recordDefinitionCacheMiss()
      } else {
        recordDefinitionCacheHit()
      }
      outcomeRecorded = true
      state.lastRefresh = new Date()
      return { features: state.features, performed: true }
    } catch (error) {
      if (policy.frontend && (destroyed || expected !== generation)) return { features: state.features, performed: false }
      state.error = error as Error
      if (reportRefreshError) {
        reportError('Error refreshing feature flags', error)
      }

      if (
        !outcomeRecorded &&
        (state.definitions.size > 0 || Object.keys(state.features).length > 0)
      ) {
        recordDefinitionCacheHit()
      }

      throw error
    } finally {
      if (!policy.frontend || expected === generation) {
        state.loading = false
        refreshInFlight = false
      }
    }
  }

  /**
   * Start the auto-refresh interval
   */
  function startRefreshInterval(): void {
    if ((policy.frontend && (destroyed || typeof window === 'undefined')) || refreshIntervalId || config.refreshInterval <= 0) {
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
      (policy.frontend && (destroyed || typeof window === 'undefined')) ||
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
      if (policy.frontend) {
        config.instanceId = undefined
        transitionBrowserContext()
        if (state.initialized && !destroyed) { startRefreshInterval(); startWebSocket() }
      }
    },

    async init(newConfig?: TogglyConfig): Promise<FeatureDefinitions> {
      if (destroyed) {
        throw new Error('[Toggly] Client has been destroyed')
      }

      const expected = policy.frontend ? ++generation : generation
      if (policy.frontend) {
        stopWebSocket()
        stopRefreshInterval()
        refreshInFlight = false
        if (newConfig && ((newConfig.appKey !== undefined && newConfig.appKey !== config.appKey) || (newConfig.environment !== undefined && newConfig.environment !== config.environment))) {
          state.features = { ...newConfig.featureDefaults }
          state.definitions = new Map()
          config.featureDefaults = newConfig.featureDefaults ?? {}
          cachedDefinitionsRevision = null
          pendingDefinitionsPin = null
        }
        if (newConfig?.localGates) client.setLocalGates(newConfig.localGates)
      }
      const replaceTransport = newConfig && ['metricsBaseUrl', 'telemetryFetch', 'telemetryFlushIntervalMs', 'enableTelemetry', 'enableUsageTracking', 'enableMetrics'].some(key => key in newConfig && newConfig[key as keyof TogglyConfig] !== config[key as keyof TogglyConfig])
      if (policy.frontend && replaceTransport) { void telemetry?.close({flush: false}); telemetry = null }
      if (policy.frontend && newConfig?.identity !== undefined && newConfig.instanceId === undefined) config.instanceId = undefined
      // Merge new config if provided
      if (newConfig) {
        Object.assign(config, newConfig)
      }

      // Generate identity if not provided
      if (!config.identity) {
        config.identity = generateUUID()
      }

      if (policy.frontend) {
        config.instanceId = config.instanceId?.trim() || undefined
        if (activeScope !== scopeKey()) { activeScope = scopeKey(); restoreSnapshot() }
      }
      state.loading = true
      state.error = null

      try {
        // Start usage/metrics before first refresh so snapshot + refresh outcomes are recorded.
        if (policy.frontend && telemetry) telemetry.setContext?.(config)
        else startTelemetry()

        // Startup served from durable snapshot (hydrateDefinitions) before network — cache hit.
        if (state.definitions.size > 0) {
          recordDefinitionCacheHit()
        }

        try {
          await refreshFeatures({ reportRefreshError: false })
          if (policy.frontend && (destroyed || expected !== generation)) return state.features
        } catch {
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

        // Execute afterRefresh hooks
        await hookExecutor.executeAfterRefresh(state.features)
        notifyFeaturesRefresh()

        if (policy.frontend && (destroyed || expected !== generation)) return state.features

        // Start auto-refresh
        startRefreshInterval()

        // Start WebSocket for live updates (browser + Node server)
        startWebSocket()

        return state.features
      } catch (error) {
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
        if (!policy.frontend || expected === generation) state.loading = false
      }
    },

    async refresh(): Promise<FeatureDefinitions> {
      if (destroyed) {
        throw new Error('[Toggly] Client has been destroyed')
      }

      const { features, performed } = await refreshFeatures()
      if (performed) {
        await hookExecutor.executeAfterRefresh(state.features)
        notifyFeaturesRefresh()
      }
      return features
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

      const snapshot = policy.frontend ? captureEvaluation() : undefined
      const entityContext = normalizeEntityContext(context, kind)

      // Execute before hooks
      const dataMap = await hookExecutor.executeBeforeEvaluation(
        featureKey,
        (snapshot?.ownerConfig ?? config).featureDefaults?.[featureKey]
      )

      const result = evaluateAndRecordCheck(featureKey, entityContext, overrides, snapshot)

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
      const isOn = await client.isFeatureOn(featureKey, context, kind, overrides)
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

      if (policy.frontend && featureKeys.length === 0) return !negate

      const snapshot = policy.frontend ? captureEvaluation() : undefined
      const entityContext = normalizeEntityContext(context, kind)

      if (policy.frontend) {
        let result = requirement !== 'any'
        for (const key of featureKeys) {
          const dataMap = await hookExecutor.executeBeforeEvaluation(key, snapshot?.ownerConfig.featureDefaults?.[key])
          const enabled = evaluateAndRecordCheck(key, entityContext, overrides, snapshot)
          void hookExecutor.executeAfterEvaluation(key, dataMap, enabled).catch(() => {})
          result = enabled
          if ((requirement === 'any' && enabled) || (requirement !== 'any' && !enabled)) break
        }
        return negate ? !result : result
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

      // evaluateGateEffective records usage once per key
      const result = evaluateGateEffective(
        featureKeys,
        requirement,
        negate,
        entityContext,
        overrides,
      )

      // Execute after hooks for each key (fire-and-forget)
      for (const { key, dataMap } of dataMaps) {
        const keyResult = getEffectiveFlag(key, entityContext, overrides)
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
      if (policy.frontend) return client.setContext({identity})
      if (destroyed) {
        return
      }

      const expected = generation
      const previousIdentity = config.identity
      const previousFeatures = { ...state.features }

      // Execute before hooks
      const dataMap = await hookExecutor.executeBeforeIdentify(identity)
      if (policy.frontend && (destroyed || expected !== generation)) return

      if (!state.initialized) {
        config.identity = identity
        await hookExecutor.executeAfterIdentify(identity, dataMap)
        if (policy.frontend && (destroyed || expected !== generation)) return
        return
      }

      // Local: re-snapshot with the new identity (no remote refresh).
      if (isLocalMode()) {
        config.identity = identity
        await hookExecutor.executeAfterIdentify(identity, dataMap)
        if (policy.frontend && (destroyed || expected !== generation)) return
        applyLocalDefinitions(state.definitions)
        notifyFeaturesRefresh()
        return
      }

      // Remote: withhold prior enables before publishing the new identity.
      state.features = { ...config.featureDefaults }
      notifyFeaturesRefresh()

      config.identity = identity
      await hookExecutor.executeAfterIdentify(identity, dataMap)
      if (policy.frontend && (destroyed || expected !== generation)) return

      try {
        await client.refresh()
      } catch (error) {
        if (policy.frontend && (destroyed || expected !== generation)) return
        config.identity = previousIdentity
        state.features = previousFeatures
        notifyFeaturesRefresh()
        throw error
      }
    },

    async setContext(contextUpdate: {
      instanceId?: string
      identity?: string
      groups?: string[]
      claims?: Record<string, string>
    }): Promise<void> {
      if (destroyed) {
        return
      }

      if (policy.frontend) {
        const expected = ++generation
        const dataMap = contextUpdate.identity !== undefined ? await hookExecutor.executeBeforeIdentify(contextUpdate.identity) : undefined
        if (destroyed || expected !== generation) return
        if (contextUpdate.identity !== undefined) {
          config.identity = contextUpdate.identity
          if (contextUpdate.instanceId === undefined) config.instanceId = undefined
        }
        if (contextUpdate.instanceId !== undefined) config.instanceId = contextUpdate.instanceId.trim() || undefined
        if (contextUpdate.groups !== undefined) config.groups = contextUpdate.groups
        if (contextUpdate.claims !== undefined) config.claims = contextUpdate.claims
        transitionBrowserContext()
        const installed = generation
        if (dataMap) await hookExecutor.executeAfterIdentify(contextUpdate.identity!, dataMap)
        if (destroyed || installed !== generation) return
        if (state.initialized) {
          try { if (!isLocalMode()) await client.refresh() }
          finally { if (!destroyed && installed === generation) { startRefreshInterval(); startWebSocket() } }
        }
        return
      }

      const identityChanged =
        contextUpdate.identity !== undefined &&
        contextUpdate.identity !== config.identity
      const groupsChanged =
        contextUpdate.groups !== undefined &&
        JSON.stringify(contextUpdate.groups) !== JSON.stringify(config.groups)
      const claimsChanged =
        contextUpdate.claims !== undefined &&
        JSON.stringify(contextUpdate.claims) !== JSON.stringify(config.claims)

      const contextChanged = identityChanged || groupsChanged || claimsChanged
      if (!contextChanged) {
        return
      }

      const expected = generation
      const previousIdentity = config.identity
      const previousGroups = config.groups
      const previousClaims = config.claims
      const previousFeatures = { ...state.features }

      const applyContextFields = async () => {
        if (contextUpdate.identity !== undefined) {
          const dataMap = await hookExecutor.executeBeforeIdentify(
            contextUpdate.identity,
          )
          if (policy.frontend && (destroyed || expected !== generation)) return
          config.identity = contextUpdate.identity
          await hookExecutor.executeAfterIdentify(
            contextUpdate.identity,
            dataMap,
          )
          if (policy.frontend && (destroyed || expected !== generation)) return
        }
        if (contextUpdate.groups !== undefined) {
          config.groups = contextUpdate.groups
        }
        if (contextUpdate.claims !== undefined) {
          config.claims = contextUpdate.claims
        }
      }

      if (!state.initialized) {
        await applyContextFields()
        if (policy.frontend && (destroyed || expected !== generation)) return
        return
      }

      // Local: re-snapshot with the new eval context so provider subscribers
      // and hooks that depend on `features` pick up claim/group/identity changes.
      if (isLocalMode()) {
        await applyContextFields()
        if (policy.frontend && (destroyed || expected !== generation)) return
        applyLocalDefinitions(state.definitions)
        notifyFeaturesRefresh()
        return
      }

      // Remote: withhold prior targeting enables before applying new context.
      state.features = { ...config.featureDefaults }
      notifyFeaturesRefresh()
      await applyContextFields()
      if (policy.frontend && (destroyed || expected !== generation)) return

      try {
        await client.refresh()
      } catch (error) {
        if (policy.frontend && (destroyed || expected !== generation)) return
        config.identity = previousIdentity
        config.groups = previousGroups
        config.claims = previousClaims
        state.features = previousFeatures
        notifyFeaturesRefresh()
        throw error
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
      const features = applyLocalDefinitions(indexDefinitions(defs))
      // Durable snapshot apply after telemetry is running (e.g. last-known-good
      // recovery). Startup hydrate-before-init is counted in init() instead.
      if (state.initialized && defs.length > 0) {
        recordDefinitionCacheHit()
      }
      return features
    },

    getVariant(featureKey: string): VariantResult | null {
      if (destroyed || !config.enableVariants) {
        return null
      }
      const entry = state.variants?.[featureKey]
      const variantName = entry?.variant || 'enabled'
      const remoteEnabled = entry?.enabled === true
      const enabled = applyLocalGate(remoteEnabled, featureKey, localGates, localGateIndex)
      if (policy.frontend) ensureTelemetry()
      if (telemetry?.usageEnabled) {
        telemetry.recordCheck(featureKey, enabled, config.identity, enabled ? variantName : 'disabled')
      }
      if (!enabled || !entry?.variant) {
        return null
      }
      return { name: entry.variant, configurationValue: entry.configurationValue }
    },

    getVariantValue(featureKey: string): unknown | null {
      return client.getVariant(featureKey)?.configurationValue ?? null
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
      ensureTelemetry()?.recordUsage(featureKey, identity ?? config.identity, variant)
    },

    recordView(featureKey: string, identity?: string, variant?: string): void {
      ensureTelemetry()?.recordView(featureKey, identity ?? config.identity, variant)
    },

    measure(
      metricKey: string,
      value: number,
      options?: { feature?: string; variant?: string },
    ): void {
      ensureTelemetry()?.measure(metricKey, value, options)
    },

    incrementCounter(
      metricKey: string,
      value = 1,
      options?: { feature?: string; variant?: string },
    ): void {
      ensureTelemetry()?.incrementCounter(metricKey, value, options)
    },

    observe(
      metricKey: string,
      value: number,
      options?: { feature?: string; variant?: string },
    ): void {
      ensureTelemetry()?.observe(metricKey, value, options)
    },

    async flushTelemetry(): Promise<void> {
      await telemetry?.flushAll()
    },

    telemetry: policy.frontend ? {
      recordUsage: (key, variant = 'enabled') => client.recordUsage(key, undefined, variant),
      recordView: (key, variant = 'enabled') => client.recordView(key, undefined, variant),
      incrementCounter: (key, value = 1) => client.incrementCounter(key, value),
      setGauge: (key, value) => { ensureTelemetry()?.setGauge?.(key, value) },
      flushTelemetry: () => client.flushTelemetry(),
    } : undefined,

    destroy(): void {
      destroyed = true
      generation++
      stopWebSocket()
      stopRefreshInterval()
      hookExecutor.clearHooks()
      if (policy.frontend) { featuresRefreshListeners.clear(); localGatesListeners.clear() }
      if (telemetry) {
        void telemetry.close()
        telemetry = null
      }
    },
  }

  return client
}
