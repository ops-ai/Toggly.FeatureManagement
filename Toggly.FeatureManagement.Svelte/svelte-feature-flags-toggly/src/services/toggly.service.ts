import type { CacheLruIndex, EvaluatedDefinitions, Hook, TogglyEntityContext, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import {
  buildEvaluatedSignedUrl,
  evaluationContextCacheKey,
  isCacheLruEnabled,
  evaluateStoredFeatureKeys,
  normalizeEntityContext,
  parseCacheLruIndex,
  registerContext as registerEntityContext,
  removeCacheLruKeys,
  resolveEvaluatedDefinition,
  selectCacheLruKeysToEvict,
  serializeCacheLruIndex,
  toBooleanDefinitions,
  touchCacheLruKey,
} from '@ops-ai/toggly-hooks-types';
import {
  applyLocalGate,
  buildFlagGateIndex,
  type FlagGateIndex,
  type LocalGate,
} from '@ops-ai/toggly-local-gates';
import { HookExecutor } from './hooks';
import type { EvaluatedVariantDef, VariantResult } from './variant.types';
import {
  buildWebSocketUrl,
  getNextReconnectDelayMs,
  REFRESH_DEBOUNCE_MS,
  appendDefinitionsRevisionParam,
  planFlagsUpdatedRefresh,
  shouldFetchOnSync,
  type WsSyncMessage,
} from '../utils/ws-sync';
import { buildDefinitionFetchHeaders } from '../utils/sdk-identity'
import { createTelemetryReporter, type TelemetryReporter } from '@ops-ai/toggly-client-telemetry'
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser'
import {
  InMemoryJwksCache,
  asVariantDefsRecord,
  fetchEvaluatedSignedDefinitions,
  resolveEvaluatedFetchErrorState,
} from '@ops-ai/toggly-signed-defs'

const canUseStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
const CACHE_PREFIX = 'toggly:flags:'
const VARIANTS_CACHE_PREFIX = 'toggly:variants:'
const REVISION_CACHE_PREFIX = 'toggly:revision:'
const CACHE_LRU_KEY = 'toggly:cache-lru'

function getCacheKey(appKey: string, environment: string, contextKey = ''): string {
  const suffix = contextKey ? `:${contextKey}` : ''
  return `${CACHE_PREFIX}${appKey}:${environment}${suffix}`
}

function getVariantsCacheKey(appKey: string, environment: string, contextKey = ''): string {
  const suffix = contextKey ? `:${contextKey}` : ''
  return `${VARIANTS_CACHE_PREFIX}${appKey}:${environment}${suffix}`
}

function getRevisionCacheKey(appKey: string, environment: string, contextKey = ''): string {
  return `${REVISION_CACHE_PREFIX}${appKey}:${environment}:${contextKey}`
}

function isTrackedCacheKey(key: string): boolean {
  return key.startsWith(CACHE_PREFIX) || key.startsWith(VARIANTS_CACHE_PREFIX)
}

function loadLruIndex(): CacheLruIndex {
  try {
    return parseCacheLruIndex(localStorage.getItem(CACHE_LRU_KEY))
  } catch {
    return parseCacheLruIndex(null)
  }
}

function saveLruIndex(index: CacheLruIndex): void {
  try {
    localStorage.setItem(CACHE_LRU_KEY, serializeCacheLruIndex(index))
  } catch { /* storage full or unavailable */ }
}

function touchCacheKey(key: string, maxCacheKeys?: number | null): void {
  if (!canUseStorage || !isCacheLruEnabled(maxCacheKeys) || !isTrackedCacheKey(key)) {
    return
  }
  try {
    saveLruIndex(touchCacheLruKey(loadLruIndex(), key))
  } catch { /* ignore LRU failures */ }
}

function enforceMaxCacheKeys(protectKeys: string[], maxCacheKeys?: number | null): void {
  if (!canUseStorage || !isCacheLruEnabled(maxCacheKeys)) {
    return
  }
  try {
    let index = loadLruIndex()
    const toEvict = selectCacheLruKeysToEvict(index, maxCacheKeys as number, { protectKeys }).filter(
      (key) => isTrackedCacheKey(key),
    )
    if (toEvict.length === 0) {
      return
    }
    for (const key of toEvict) {
      try {
        localStorage.removeItem(key)
        // Revisions belong to their bodies and do not consume separate LRU slots.
        const prefix = key.startsWith(CACHE_PREFIX) ? CACHE_PREFIX : VARIANTS_CACHE_PREFIX
        localStorage.removeItem(REVISION_CACHE_PREFIX + key.slice(prefix.length))
      } catch { /* ignore per-key removal failures */ }
    }
    index = removeCacheLruKeys(index, toEvict)
    saveLruIndex(index)
  } catch { /* ignore LRU failures */ }
}

function removeCacheKeysFromLruIndex(keys: string[], maxCacheKeys?: number | null): void {
  if (!canUseStorage || !isCacheLruEnabled(maxCacheKeys)) {
    return
  }
  try {
    saveLruIndex(removeCacheLruKeys(loadLruIndex(), keys))
  } catch { /* ignore LRU failures */ }
}

function clearCachedFlagsAndVariants(
  appKey: string,
  environment: string,
  contextKey = '',
  maxCacheKeys?: number | null,
): void {
  if (!canUseStorage) return
  try {
    const flagsKey = getCacheKey(appKey, environment, contextKey)
    const variantsKey = getVariantsCacheKey(appKey, environment, contextKey)
    const revisionKey = getRevisionCacheKey(appKey, environment, contextKey)
    localStorage.removeItem(flagsKey)
    localStorage.removeItem(variantsKey)
    localStorage.removeItem(revisionKey)
    removeCacheKeysFromLruIndex([flagsKey, variantsKey], maxCacheKeys)
  } catch { /* ignore */ }
}

function readCachedRevision(appKey: string, environment: string, contextKey: string): string | null {
  if (!canUseStorage) return null
  try {
    return localStorage.getItem(getRevisionCacheKey(appKey, environment, contextKey))
  } catch { return null }
}

function writeCachedRevision(appKey: string, environment: string, revision: string, contextKey: string): void {
  if (!canUseStorage) return
  try {
    localStorage.setItem(getRevisionCacheKey(appKey, environment, contextKey), revision)
  } catch { /* storage full or unavailable */ }
}

function variantDefsToFlags(defs: { [key: string]: EvaluatedVariantDef }): { [key: string]: boolean } {
  const out: { [key: string]: boolean } = {}
  for (const key of Object.keys(defs)) {
    out[key] = defs[key]?.enabled === true
  }
  return out
}

function readCachedFlags(
  appKey: string,
  environment: string,
  contextKey = '',
  maxCacheKeys?: number | null,
): EvaluatedDefinitions | null {
  if (!canUseStorage) return null
  try {
    const key = getCacheKey(appKey, environment, contextKey)
    const raw = localStorage.getItem(key)
    const parsed = raw ? (JSON.parse(raw) as EvaluatedDefinitions | null) : null
    if (raw != null && parsed != null) {
      touchCacheKey(key, maxCacheKeys)
    }
    return parsed
  } catch { return null }
}

function writeCachedFlags(
  appKey: string,
  environment: string,
  flags: EvaluatedDefinitions,
  contextKey = '',
  maxCacheKeys?: number | null,
): void {
  if (!canUseStorage) return
  try {
    const key = getCacheKey(appKey, environment, contextKey)
    const variantsKey = getVariantsCacheKey(appKey, environment, contextKey)
    localStorage.setItem(key, JSON.stringify(flags))
    touchCacheKey(key, maxCacheKeys)
    enforceMaxCacheKeys([key, variantsKey], maxCacheKeys)
  } catch { /* storage full or unavailable */ }
}

function readCachedVariants(
  appKey: string,
  environment: string,
  contextKey = '',
  maxCacheKeys?: number | null,
): { [key: string]: EvaluatedVariantDef } | null {
  if (!canUseStorage) return null
  try {
    const key = getVariantsCacheKey(appKey, environment, contextKey)
    const raw = localStorage.getItem(key)
    const parsed = raw ? (JSON.parse(raw) as { [key: string]: EvaluatedVariantDef } | null) : null
    if (raw != null && parsed != null) {
      touchCacheKey(key, maxCacheKeys)
    }
    return parsed
  } catch { return null }
}

function writeCachedVariants(
  appKey: string,
  environment: string,
  variants: { [key: string]: EvaluatedVariantDef },
  contextKey = '',
  maxCacheKeys?: number | null,
): void {
  if (!canUseStorage) return
  try {
    const key = getVariantsCacheKey(appKey, environment, contextKey)
    const flagsKey = getCacheKey(appKey, environment, contextKey)
    localStorage.setItem(key, JSON.stringify(variants))
    touchCacheKey(key, maxCacheKeys)
    enforceMaxCacheKeys([flagsKey, key], maxCacheKeys)
  } catch { /* storage full or unavailable */ }
}

/** Partial updates preserve omitted fields; an empty instanceId clears the minted token. */
export interface TogglyContext extends TogglyEvaluationContext {
  instanceId?: string
}

export interface TogglyOptions {
  baseURI?: string
  verifySignatures?: boolean
  /**
   * When verifySignatures is enabled, only accept signatures from these key IDs.
   * Omit / empty = any kid present in JWKS is accepted.
   */
  allowedKeyIds?: string[]
  /**
   * Reject signed envelopes older than this many seconds when verifySignatures is enabled.
   * Omit / null / <=0 = disabled (back-compat).
   */
  maxSignatureAgeSeconds?: number | null
  appKey?: string
  /** Send bounded frontend telemetry for keyed browser clients (default: true). */
  enableTelemetry?: boolean
  /** Independent telemetry endpoint; defaults to https://metrics.toggly.io. */
  metricsBaseUrl?: string
  /** Telemetry flush interval in milliseconds, 30000–60000 (default: 45000). */
  telemetryFlushIntervalMs?: number
  environment?: string
  identity?: string
  /** Host-minted capability; takes precedence over client identity/groups/claims. */
  instanceId?: string
  groups?: string[]
  claims?: Record<string, string>
  featureDefaults?: { [key: string]: boolean }
  showFeatureDuringEvaluation?: boolean
  featureFlagsRefreshInterval?: number
  /** Enable live updates via WebSocket (default: true) */
  enableLiveUpdates?: boolean
  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[]
  /** Enable localStorage caching of definitions. Default: true. Set false for SSR-only or privacy-sensitive contexts. */
  persistCache?: boolean
  /** Max identity-scoped cache keys (flags/variants). null/omit = unlimited. */
  maxCacheKeys?: number | null
  /**
   * When true, fetches from /evaluated-variants-signed and exposes {@link Toggly.getVariant} / {@link Toggly.getVariantValue}.
   */
  enableVariants?: boolean
  localGates?: LocalGate[]
  onError?: (message: string, error?: unknown) => void
}

export interface TogglyService {
  shouldShowFeatureDuringEvaluation: boolean
  _loadFeatures: (forceRefresh?: boolean) => Promise<EvaluatedDefinitions | null>
  _featuresLoaded: () => Promise<EvaluatedDefinitions | null>
  _evaluateFeatureGate: (
    gate: string[],
    requirement: string,
    negate: boolean,
    entityContext?: TogglyEntityContext | null,
  ) => Promise<boolean>
  evaluateFeatureGate: (
    featureKeys: string[],
    requirement?: string,
    negate?: boolean,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => Promise<boolean>
  isFeatureOn: (
    featureKey: string,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => Promise<boolean>
  isFeatureOff: (
    featureKey: string,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => Promise<boolean>
  refreshFlags: () => Promise<void>
  startWebSocket: () => void
  stopWebSocket: () => void
  addHook: (hook: Hook) => void
  removeHook: (name: string) => boolean
  getVariant: (featureKey: string) => VariantResult | null
  getVariantValue: (featureKey: string) => unknown | null
  /** Variant defs map when {@link TogglyOptions.enableVariants} is true; otherwise null. */
  getVariantDefinitions: () => { [key: string]: EvaluatedVariantDef } | null
  setLocalGates: (gates: LocalGate[]) => void
  notifyLocalGatesChanged: () => void
  subscribeLocalGatesChanged: (listener: () => void) => () => void
  setContext: (context: TogglyContext) => Promise<void>
  getEffectiveFlagValue: (featureKey: string) => boolean
  recordUsage: (featureKey: string, variant?: string) => void
  recordView: (featureKey: string, variant?: string) => void
  incrementCounter: (metricKey: string, value?: number) => void
  setGauge: (metricKey: string, value: number) => void
  flushTelemetry: () => Promise<void>
  dispose: () => void
}

export class Toggly implements TogglyService {
  private _config: TogglyOptions = {
    baseURI: 'https://definitions.toggly.io',
    verifySignatures: false,
    showFeatureDuringEvaluation: false,
    featureFlagsRefreshInterval: 3 * 60 * 1000, // 3 minutes
    hooks: []
  }
  private _features: EvaluatedDefinitions | null = null
  private _variants: { [key: string]: EvaluatedVariantDef } | null = null
  private _generation = 0
  private _loadingFeatures: boolean = false
  private _lastFetchTime: number = 0
  private _hookExecutor = new HookExecutor()
  private _localGates: LocalGate[] = []
  private _localGateIndex: FlagGateIndex = new Map()
  private _localGatesChangedListeners = new Set<() => void>()
  private _lastError: string | undefined
  private _groups: string[] = []
  private _claims: Record<string, string> = {}

  _ws: WebSocket | null = null
  _wsConnected: boolean = false
  _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
  _wsReconnectAttempt = 0
  _refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null
  _cachedDefinitionsRevision: string | null = null
  _pendingDefinitionsPin: string | null = null
  _lastFallbackRefresh: number = 0
  private _fallbackRefreshInterval: number = 20 * 60 * 1000
  private _jwks = new InMemoryJwksCache()
  private _telemetry: TelemetryReporter | null = null
  private _detachTelemetry: (() => void) | null = null
  private _telemetryFailed = false
  private _disposed = false
  private _refreshTimer: ReturnType<typeof setInterval> | null = null

  get isDisposed(): boolean { return this._disposed }

  /** Let the service own the periodic refresh started by createToggly. */
  setRefreshTimer(timer: ReturnType<typeof setInterval>): void {
    if (this._disposed) clearInterval(timer)
    else {
      if (this._refreshTimer) clearInterval(this._refreshTimer)
      this._refreshTimer = timer
    }
  }

  private _ensureTelemetry(): TelemetryReporter | null {
    if (this._disposed || this._telemetryFailed || this._config.enableTelemetry === false ||
        !this._config.appKey || typeof window === 'undefined' || typeof document === 'undefined') return null
    if (!this._telemetry) {
      try {
        this._telemetry = createTelemetryReporter({
          appKey: this._config.appKey,
          environment: this._config.environment,
          identity: this._config.identity,
          instanceId: this._config.instanceId,
          enableTelemetry: this._config.enableTelemetry,
          metricsBaseUrl: this._config.metricsBaseUrl,
          telemetryFlushIntervalMs: this._config.telemetryFlushIntervalMs,
          onDiagnostic: diagnostic => {
            try { this._reportError(`Toggly telemetry: ${diagnostic}`) } catch { /* diagnostic callbacks are best effort */ }
          },
        })
        this._detachTelemetry = attachBrowserLifecycle(this._telemetry)
      } catch {
        this._telemetryFailed = true
        this._telemetry?.dispose()
        this._telemetry = null
      }
    }
    return this._telemetry
  }

  private _captureEvaluation() {
    let record: ReturnType<TelemetryReporter['captureCheck']> | undefined
    try { record = this._ensureTelemetry()?.captureCheck() } catch { /* best effort */ }
    return { features: this._features, variants: this._variants, gates: this._localGates, index: this._localGateIndex, record }
  }

  private _evaluateCaptured(featureKey: string, snapshot: ReturnType<Toggly['_captureEvaluation']>, entityContext?: TogglyEntityContext | null): boolean {
    const variant = snapshot.variants?.[featureKey]?.variant
    const remote = resolveEvaluatedDefinition(snapshot.features?.[featureKey], entityContext)
    const enabled = applyLocalGate(remote, featureKey, snapshot.gates, snapshot.index)
    try { snapshot.record?.(featureKey, enabled ? (variant || 'enabled') : 'disabled') } catch { /* best effort */ }
    return enabled
  }

  /** Callback invoked after flags are refreshed (used by createToggly to update the store) */
  onFlagsUpdated: ((flags: { [key: string]: boolean }) => void) | null = null

  /** Callback invoked when variant defs change (used by createToggly when enableVariants is true) */
  onVariantsUpdated: ((defs: { [key: string]: EvaluatedVariantDef }) => void) | null = null

  /** Callback invoked when local gate state changes (no network) */
  onLocalGatesUpdated: (() => void) | null = null

  shouldShowFeatureDuringEvaluation: boolean = false

  get lastError(): string | undefined {
    return this._lastError
  }

  private _reportError(message: string, error?: unknown): void {
    this._lastError = message
    this._config.onError?.(message, error)
  }

  private get _definitionsRevision(): string | null {
    if (this._cachedDefinitionsRevision) {
      return this._cachedDefinitionsRevision
    }
    if (!this._canPersist || !this._config.appKey) {
      return null
    }
    const env = this._config.environment ?? 'Production'
    const scope = this._contextCacheKey()
    if (!readCachedFlags(this._config.appKey, env, scope) ||
        (this._config.enableVariants && !readCachedVariants(this._config.appKey, env, scope))) return null
    return readCachedRevision(this._config.appKey, env, scope)
  }

  private _cacheDefinitionsRevision(revision: string | null | undefined): void {
    if (!revision || !this._config.appKey) {
      return
    }
    this._cachedDefinitionsRevision = revision
    if (this._canPersist) {
      const appKey = this._config.appKey
      const environment = this._config.environment ?? 'Production'
      const context = this._contextCacheKey()
      // Another owner can evict storage while this owner retains its memory body.
      // A valid in-memory304 must not recreate a persisted orphan validator.
      if (readCachedFlags(appKey, environment, context) !== null &&
          (!this._config.enableVariants || readCachedVariants(appKey, environment, context) !== null)) {
        writeCachedRevision(appKey, environment, revision, context)
      }
    }
  }

  private _scheduleDebouncedRefresh(forceJwksRefresh = false): void {
    if (this._disposed) return
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer)
    }
    this._refreshDebounceTimer = setTimeout(() => {
      this._refreshDebounceTimer = null
      if (this._disposed) return
      if (forceJwksRefresh) {
        this._cachedDefinitionsRevision = null
        if (this._config.verifySignatures) {
          this._jwks.clear()
        }
      }
      void this.refreshFlags()
    }, REFRESH_DEBOUNCE_MS)
  }

  private _handleWsSyncMessage(message: WsSyncMessage): void {
    const previousRevision = this._definitionsRevision
    if (shouldFetchOnSync(message, previousRevision)) {
      // Do not cache WS etag before HTTP confirms — avoids conditional 304 with stale defs.
      this._scheduleDebouncedRefresh()
      return
    }
    if (message.etag) {
      this._cacheDefinitionsRevision(message.etag)
    }
  }

  private _refreshAfterSigningKeyUpdate(): void {
    this._scheduleDebouncedRefresh(true)
  }

  private _refreshWithDefinitionsPin(pin: string | null): void {
    this._pendingDefinitionsPin = pin
    this._cachedDefinitionsRevision = null
    this._scheduleDebouncedRefresh()
  }

  private _rememberDefinitionsEtag(etag: string): void {
    this._cacheDefinitionsRevision(etag)
  }

  private _handleWsUpdateMessage(message: WsSyncMessage): void {
    const plan = planFlagsUpdatedRefresh(message, this._definitionsRevision)
    if (plan.action === 'refresh-jwks') {
      this._refreshAfterSigningKeyUpdate()
      return
    }
    if (plan.action === 'refresh-pinned') {
      this._refreshWithDefinitionsPin(plan.pin)
      return
    }
    if (message.etag) {
      this._rememberDefinitionsEtag(message.etag)
    }
  }

  constructor(config: TogglyOptions) {
    if (!config.appKey) {
      if (config.featureDefaults) {
        this._features = config.featureDefaults ?? {}

        console.warn(
          'Toggly --- Using feature defaults as no application key provided when initializing the Toggly',
        )
      } else {
        console.warn(
          'Toggly --- A valid application key is required to connect to your Toggly.io application for evaluating your features.',
        )
      }
    } else {
      if (!config.environment) {
        config.environment = 'Production'

        console.warn(
          'Toggly --- Using Production environment as no environment provided when initializing the Toggly',
        )
      }
    }

    this._config = Object.assign({}, this._config, config)
    this.shouldShowFeatureDuringEvaluation = this._config.showFeatureDuringEvaluation ?? false
    
    // Register initial hooks
    if (this._config.hooks) {
      this._config.hooks.forEach(hook => this._hookExecutor.addHook(hook))
    }

    if (this._config.localGates) {
      this.setLocalGates(this._config.localGates)
    }

    this._groups = this._config.groups ? [...this._config.groups] : []
    this._claims = this._config.claims ? { ...this._config.claims } : {}

    // Seed in-memory features (and variants) from localStorage for instant availability
    if (this._features === null && this._canPersist && this._config.appKey) {
      const appKey = this._config.appKey
      const env = this._config.environment ?? 'Production'
      const contextKey = this._contextCacheKey()
      if (this._config.enableVariants) {
        const vCached = readCachedVariants(appKey, env, contextKey, this._config.maxCacheKeys)
        if (vCached) {
          this._variants = vCached
          this._features = variantDefsToFlags(vCached)
        }
      }
      if (this._features === null) {
        const cached = readCachedFlags(appKey, env, contextKey, this._config.maxCacheKeys)
        if (cached) {
          this._features = cached
        }
      }
    }
  }

  private get _canPersist(): boolean {
    return this._config.persistCache !== false && canUseStorage
  }

  private _getEvaluationContext(): TogglyEvaluationContext {
    return {
      identity: this._config.identity || undefined,
      groups: this._groups.length ? [...this._groups] : undefined,
      claims: Object.keys(this._claims).length ? { ...this._claims } : undefined,
    }
  }

  private _contextCacheKey(): string {
    return JSON.stringify([this._config.enableVariants ? 'variants' : 'evaluated', this._config.instanceId?.trim() ? ['i', this._config.instanceId.trim()] : ['context', evaluationContextCacheKey(this._getEvaluationContext())]])
  }

  private notifyFeaturesRefresh(): void {
    if (this._features && this.onFlagsUpdated) {
      this.onFlagsUpdated(toBooleanDefinitions(this._features))
    }
    if (this._config.enableVariants && this.onVariantsUpdated) {
      this.onVariantsUpdated(this._variants ?? {})
    }
  }

  setContext = async (context: TogglyContext): Promise<void> => {
    if (this._disposed) return
    const generation = ++this._generation
    this.stopWebSocket()
    if (context.identity !== undefined) this._config.identity = context.identity || undefined
    if (context.instanceId !== undefined) this._config.instanceId = context.instanceId.trim() || undefined
    if (context.groups !== undefined) this._groups = [...context.groups]
    if (context.claims !== undefined) this._claims = { ...context.claims }
    this._telemetry?.setContext({ identity: this._config.identity, instanceId: this._config.instanceId })
    this._cachedDefinitionsRevision = null
    this._pendingDefinitionsPin = null
    this._loadingFeatures = false
    this._lastFetchTime = 0
    const key = this._contextCacheKey()
    const app = this._config.appKey ?? ''
    const env = this._config.environment ?? 'Production'
    this._variants = this._canPersist && this._config.enableVariants ? readCachedVariants(app, env, key, this._config.maxCacheKeys) : null
    this._features = this._variants ? variantDefsToFlags(this._variants) :
      (this._canPersist ? readCachedFlags(app, env, key, this._config.maxCacheKeys) : null) ?? { ...this._config.featureDefaults }
    this.notifyFeaturesRefresh()
    try {
      await this._loadFeatures(true, { strict: true })
    } finally {
      if (!this._disposed && generation === this._generation) {
        this.notifyFeaturesRefresh()
        this.startWebSocket()
      }
    }
  }

  _loadFeatures = async (
    forceRefresh = false,
    options?: { strict?: boolean },
  ) => {
    if (this._disposed) return this._features
    const generation = this._generation
    // Features are currently being loaded
    if (this._loadingFeatures) {
      await new Promise<void>((resolve) => {
        const checkIfApiCallFinished = () => {
          if (!this._loadingFeatures || generation !== this._generation) {
            resolve()
          } else {
            setTimeout(checkIfApiCallFinished, 100)
          }
        }
        checkIfApiCallFinished()
      })
    }
    if (this._disposed) return this._features

    if (generation !== this._generation) return this._features

    // Check if cache is still valid
    const now = Date.now()
    const cacheAge = now - this._lastFetchTime
    const refreshInterval = this._config.featureFlagsRefreshInterval ?? 3 * 60 * 1000

    if (this._features !== null && !forceRefresh) {
      if (this._wsConnected) {
        if (now - this._lastFallbackRefresh < this._fallbackRefreshInterval) {
          return this._features
        }
        this._lastFallbackRefresh = now
      } else if (cacheAge < refreshInterval) {
        return this._features
      }
    }

    this._loadingFeatures = true

    const appKey = this._config.appKey ?? ''
    const env = this._config.environment ?? 'Production'
    const contextKey = this._contextCacheKey()

    try {
      const url = buildEvaluatedSignedUrl(
        this._config.baseURI ?? 'https://definitions.toggly.io',
        appKey,
        env,
        this._config.instanceId?.trim() ? undefined : this._getEvaluationContext(),
        this._config.enableVariants ?? false,
      )

      const scopedUrl = new URL(url)
      if (this._config.instanceId?.trim()) scopedUrl.searchParams.set('i', this._config.instanceId.trim())
      const pin = this._pendingDefinitionsPin
      this._pendingDefinitionsPin = null
      const fetchUrl = appendDefinitionsRevisionParam(scopedUrl.toString(), pin)

      const loaded = await fetchEvaluatedSignedDefinitions(
        fetchUrl,
        this._jwks,
        {
          ...this._config,
          baseURI: this._config.baseURI ?? 'https://definitions.toggly.io',
        },
        {
          revision: pin ? null : this._definitionsRevision,
          headers: buildDefinitionFetchHeaders(),
        },
      )
      if (this._disposed || generation !== this._generation) return this._features
      if (loaded.notModified) {
        if (loaded.revision) this._cacheDefinitionsRevision(loaded.revision.replace(/^"+|"+$/g, ''))
        this._lastFetchTime = Date.now()
        return this._features
      }
      const parsedDefs = loaded.defs
      this._lastFetchTime = Date.now()

      if (this._config.enableVariants) {
        const defs = asVariantDefsRecord<EvaluatedVariantDef>(parsedDefs)
        this._variants = defs
        this._features = variantDefsToFlags(defs)
        if (this._features && this._canPersist) {
          writeCachedVariants(appKey, env, defs, contextKey, this._config.maxCacheKeys)
          writeCachedFlags(appKey, env, this._features, contextKey, this._config.maxCacheKeys)
        }
      } else {
        this._variants = null
        this._features = (parsedDefs ?? {}) as { [key: string]: boolean }
        if (this._features && this._canPersist) {
          writeCachedFlags(appKey, env, this._features, contextKey, this._config.maxCacheKeys)
        }
      }

      // Persist validators only after their mode-scoped bodies have been written.
      if (loaded.revision) this._cacheDefinitionsRevision(loaded.revision.replace(/^"+|"+$/g, ''))

      if (this._features) {
        this._hookExecutor.executeAfterRefresh(toBooleanDefinitions(this._features))
      }
    } catch (error) {
      if (this._disposed || generation !== this._generation) return this._features
      this._reportError('Error fetching feature flags', error)
      const recovered = resolveEvaluatedFetchErrorState({
        enableVariants: !!this._config.enableVariants,
        featuresAlreadyLoaded: this._features !== null,
        readVariants: () =>
          this._canPersist
            ? readCachedVariants(appKey, env, contextKey, this._config.maxCacheKeys)
            : null,
        readFlags: () =>
          this._canPersist
            ? readCachedFlags(appKey, env, contextKey, this._config.maxCacheKeys)
            : null,
        defaults: this._config.featureDefaults ?? {},
        variantsToFlags: variantDefsToFlags,
      })
      if (recovered) {
        this._variants = recovered.variants
        this._features = recovered.features
      }
      if (options?.strict) {
        throw error
      }
      console.warn(
        'Toggly --- Using cached/default features as features could not be loaded from the Toggly API',
      )
      if (this._features) {
        this._hookExecutor.executeAfterRefresh(toBooleanDefinitions(this._features))
      }
    } finally {
      if (generation === this._generation) this._loadingFeatures = false
    }

    return this._features
  }

  _featuresLoaded = async () => {
    return this._features ?? (await this._loadFeatures())
  }

  getEffectiveFlagValue(
    featureKey: string,
    entityContext?: TogglyEntityContext | null,
  ): boolean {
    return this._evaluateCaptured(featureKey, this._captureEvaluation(), entityContext)
  }

  registerContext<T>(kind: string, mapper: (entity: T) => TogglyEntityContext): void {
    registerEntityContext(kind, mapper)
  }

  setLocalGates(gates: LocalGate[]): void {
    this._localGates = [...gates]
    this._localGateIndex = buildFlagGateIndex(this._localGates)
  }

  notifyLocalGatesChanged(): void {
    this._localGatesChangedListeners.forEach((listener) => {
      try {
        listener()
      } catch (e) {
        console.error('[Toggly] Error in local gates listener:', e)
      }
    })
    if (this.onLocalGatesUpdated) {
      this.onLocalGatesUpdated()
    }
  }

  subscribeLocalGatesChanged(listener: () => void): () => void {
    this._localGatesChangedListeners.add(listener)
    return () => {
      this._localGatesChangedListeners.delete(listener)
    }
  }

  _evaluateFeatureGate = async (
    gate: string[],
    requirement = 'all',
    negate = false,
    entityContext?: TogglyEntityContext | null,
  ) => {
    await this._featuresLoaded()
    const snapshot = this._captureEvaluation()
    return this._evaluateCapturedGate(gate, requirement, negate, entityContext, snapshot)
  }

  private _evaluateCapturedGate(gate: string[], requirement: string, negate: boolean, entityContext: TogglyEntityContext | null | undefined, snapshot: ReturnType<Toggly['_captureEvaluation']>): boolean {
    return evaluateStoredFeatureKeys(
      snapshot.features,
      gate.map(String),
      requirement === 'any' ? 'any' : 'all',
      negate,
      (key) => this._evaluateCaptured(key, snapshot, entityContext),
    )
  }

  evaluateFeatureGate = async (
    featureKeys: string[],
    requirement = 'all',
    negate = false,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => {
    await this._featuresLoaded()
    const snapshot = this._captureEvaluation()
    const entityContext = normalizeEntityContext(context, kind)
    // For gate evaluation, we call hooks with the first key as representative
    // This is a simplified approach - gates evaluate multiple flags together
    if (featureKeys.length > 0) {
      const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKeys[0])
      const result = this._evaluateCapturedGate(featureKeys, requirement, negate, entityContext, snapshot)
      await this._hookExecutor.executeAfterEvaluation(featureKeys[0], dataMap, result)
      return result
    }
    return this._evaluateCapturedGate(featureKeys, requirement, negate, entityContext, snapshot)
  }

  isFeatureOn = async (
    featureKey: string,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => {
    await this._featuresLoaded()
    const snapshot = this._captureEvaluation()
    const entityContext = normalizeEntityContext(context, kind)
    const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKey)
    const result = this._evaluateCapturedGate([featureKey], 'all', false, entityContext, snapshot)
    await this._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result)
    return result
  }

  isFeatureOff = async (
    featureKey: string,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => {
    await this._featuresLoaded()
    const snapshot = this._captureEvaluation()
    const entityContext = normalizeEntityContext(context, kind)
    const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKey)
    const result = this._evaluateCapturedGate([featureKey], 'all', true, entityContext, snapshot)
    await this._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result)
    return result
  }

  /**
   * Current variant assignment for a feature (requires enableVariants and loaded data).
   */
  getVariant(featureKey: string): VariantResult | null {
    const snapshot = this._captureEvaluation()
    const entry = this._config.enableVariants ? snapshot.variants?.[featureKey] : undefined
    const enabled = this._evaluateCaptured(featureKey, snapshot)
    if (!enabled || !entry?.variant) {
      return null
    }
    return {
      name: entry.variant,
      configurationValue: entry.configurationValue,
    }
  }

  /**
   * Configuration payload for the assigned variant, if any.
   */
  getVariantValue(featureKey: string): unknown | null {
    const variant = this.getVariant(featureKey)
    return variant?.configurationValue ?? null
  }

  getVariantDefinitions(): { [key: string]: EvaluatedVariantDef } | null {
    if (!this._config.enableVariants) {
      return null
    }
    return this._variants
  }

  refreshFlags = async (): Promise<void> => {
    if (this._disposed) return
    const generation = this._generation
    const flags = await this._loadFeatures(true)
    if (this._disposed || generation !== this._generation) return
    if (flags) {
      if (this._canPersist) {
        const ak = this._config.appKey ?? ''
        const env = this._config.environment ?? 'Production'
        const contextKey = this._contextCacheKey()
        writeCachedFlags(ak, env, flags, contextKey, this._config.maxCacheKeys)
        if (this._config.enableVariants && this._variants) {
          writeCachedVariants(ak, env, this._variants, contextKey, this._config.maxCacheKeys)
        }
      }
      if (this.onFlagsUpdated) {
        this.onFlagsUpdated(toBooleanDefinitions(flags))
      }
    }
    if (this._config.enableVariants && this.onVariantsUpdated) {
      this.onVariantsUpdated(this._variants ?? {})
    }
  }

  /**
   * Add a hook dynamically
   */

  /**
   * Clear current identity-scoped flags/variants localStorage entries and update the LRU index.
   */
  clearFeatureFlagsCache(): void {
    this._cachedDefinitionsRevision = null
    if (!this._config.appKey || !this._canPersist) {
      this._features = null
      this._variants = null
      return
    }
    clearCachedFlagsAndVariants(
      this._config.appKey,
      this._config.environment ?? 'Production',
      this._contextCacheKey(),
      this._config.maxCacheKeys,
    )
    this._features = null
    this._variants = null
  }

  addHook(hook: Hook): void {
    this._hookExecutor.addHook(hook)
  }

  /**
   * Remove a hook by name
   * @returns true if hook was found and removed, false otherwise
   */
  removeHook(name: string): boolean {
    return this._hookExecutor.removeHook(name)
  }

  startWebSocket() {
    if (this._disposed || !this._config.appKey) {
      return
    }

    if (this._config.enableLiveUpdates === false) {
      return
    }

    this.stopWebSocket()

    const wsUrl = buildWebSocketUrl(
      this._config.baseURI ?? 'https://definitions.toggly.io',
      this._config.appKey,
      this._definitionsRevision,
    )

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      if (this._disposed) return
      this._wsConnected = true
      this._wsReconnectAttempt = 0
      this._lastFallbackRefresh = Date.now()
    }

    ws.onmessage = (event) => {
      const data = event.data

      if (typeof data === 'string') {
        if (data === 'update' || data === 'flags-updated') {
          this._scheduleDebouncedRefresh()
          return
        }

        try {
          const message = JSON.parse(data) as WsSyncMessage
          if (message.type === 'ping') {
            return
          }
          if (message.type === 'sync') {
            this._handleWsSyncMessage(message)
            return
          }
          if (message.type === 'flags-updated' || message.type === 'update' || message.type === 'signing-key-updated') {
            this._handleWsUpdateMessage(message)
          }
        } catch {
          // Unrecognized message, ignore
        }
      }
    }

    ws.onclose = () => {
      if (this._disposed) return
      this._wsConnected = false
      this._ws = null

      const delay = getNextReconnectDelayMs(this._wsReconnectAttempt)
      this._wsReconnectAttempt += 1
      this._wsReconnectTimer = setTimeout(() => {
        this.startWebSocket()
      }, delay)
    }

    ws.onerror = (error) => {
      console.error('[Toggly] WebSocket error:', error)
    }

    this._ws = ws
  }

  stopWebSocket() {
    if (this._wsReconnectTimer) {
      clearTimeout(this._wsReconnectTimer)
      this._wsReconnectTimer = null
    }

    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer)
      this._refreshDebounceTimer = null
    }

    if (this._ws) {
      this._ws.onopen = null
      this._ws.onmessage = null
      this._ws.onclose = null
      this._ws.onerror = null
      this._ws.close()
      this._ws = null
    }

    this._wsConnected = false
  }

  /** Explicit events never evaluate a flag. */
  recordUsage(featureKey: string, variant = 'enabled'): void {
    try { this._ensureTelemetry()?.recordUsage(featureKey, variant) } catch { /* best effort */ }
  }

  recordView(featureKey: string, variant = 'enabled'): void {
    try { this._ensureTelemetry()?.recordView(featureKey, variant) } catch { /* best effort */ }
  }

  incrementCounter(metricKey: string, value = 1): void {
    try { this._ensureTelemetry()?.incrementCounter(metricKey, value) } catch { /* best effort */ }
  }

  setGauge(metricKey: string, value: number): void {
    try { this._ensureTelemetry()?.setGauge(metricKey, value) } catch { /* best effort */ }
  }

  flushTelemetry(): Promise<void> {
    try { return this._telemetry?.flush() ?? Promise.resolve() } catch { return Promise.resolve() }
  }

  /** Release this owner's browser, polling and telemetry resources. */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._generation++
    if (this._refreshTimer) clearInterval(this._refreshTimer)
    this._refreshTimer = null
    this.stopWebSocket()
    this._detachTelemetry?.()
    this._telemetry?.dispose()
    this._detachTelemetry = null
    this._telemetry = null
    this._localGatesChangedListeners.clear()
    this.onFlagsUpdated = null
    this.onVariantsUpdated = null
    this.onLocalGatesUpdated = null
  }
}

export default Toggly
