import { createTelemetryReporter, type TelemetryReporter } from '@ops-ai/toggly-client-telemetry'
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser'
import type {
  CacheLruIndex,
  EvaluatedDefinitions,
  Hook,
  TogglyEntityContext,
  TogglyEvaluationContext,
} from '@ops-ai/toggly-hooks-types';
import {
  buildEvaluatedSignedUrl,
  evaluationContextCacheKey,
  normalizeEvaluationClaims,
  isCacheLruEnabled,
  evaluateStoredFeatureKeys,
  normalizeEntityContext,
  toBooleanDefinitions,
  parseCacheLruIndex,
  registerContext as registerEntityContext,
  removeCacheLruKeys,
  resolveEvaluatedDefinition,
  selectCacheLruKeysToEvict,
  serializeCacheLruIndex,
  touchCacheLruKey,
} from '@ops-ai/toggly-hooks-types';
import {
  applyLocalGate,
  buildFlagGateIndex,
  type FlagGateIndex,
  type LocalGate,
} from '@ops-ai/toggly-local-gates';
import { HookExecutor } from './hooks';
import type { EvaluatedVariantDef, VariantResult } from '../variant.types';
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
import {
  InMemoryJwksCache,
  asVariantDefsRecord,
  fetchEvaluatedSignedDefinitions,
  resolveEvaluatedFetchErrorState,
} from '@ops-ai/toggly-signed-defs'

export type { EvaluatedVariantDef, VariantResult } from '../variant.types';
export type { EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types';
export { isEntityGate, mapEntityContext, normalizeEntityContext, registerContext } from '@ops-ai/toggly-hooks-types';

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

function getRevisionCacheKey(appKey: string, environment: string, scope: string): string {
  return `${REVISION_CACHE_PREFIX}${appKey}:${environment}:${scope}`
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
    localStorage.removeItem(flagsKey)
    localStorage.removeItem(variantsKey)
    localStorage.removeItem(getRevisionCacheKey(appKey, environment, `v2:evaluated:${contextKey}`))
    localStorage.removeItem(getRevisionCacheKey(appKey, environment, `v2:variants:${contextKey}`))
    removeCacheKeysFromLruIndex([flagsKey, variantsKey], maxCacheKeys)
  } catch { /* ignore */ }
}

function readCachedRevision(appKey: string, environment: string, scope: string): string | null {
  if (!canUseStorage) return null
  try {
    return localStorage.getItem(getRevisionCacheKey(appKey, environment, scope))
  } catch { return null }
}

function writeCachedRevision(appKey: string, environment: string, revision: string, scope: string): void {
  if (!canUseStorage) return
  try {
    localStorage.setItem(getRevisionCacheKey(appKey, environment, scope), revision)
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

interface EvaluationSnapshot {
  owner: Toggly
  features: EvaluatedDefinitions | null
  variants: { [key: string]: EvaluatedVariantDef } | null
  recordCheck?: ReturnType<TelemetryReporter['captureCheck']>
}

export interface TogglyContextUpdate extends TogglyEvaluationContext {
  /** Host-minted token; an empty string clears it. */
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
  environment?: string
  identity?: string
  /** Host-minted token used in preference to identity for definitions and telemetry. */
  instanceId?: string
  groups?: string[]
  claims?: Record<string, string>
  featureDefaults?: EvaluatedDefinitions
  showFeatureDuringEvaluation?: boolean
  /** Enable live updates via WebSocket (defaults to true) */
  enableLiveUpdates?: boolean
  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[]
  /** Enable localStorage caching of definitions. Default: true. Set false for SSR-only or privacy-sensitive contexts. */
  persistCache?: boolean
  /** Max identity-scoped cache keys (flags/variants). null/omit = unlimited. */
  maxCacheKeys?: number | null
  /**
   * Use /evaluated-variants-signed and expose {@link Toggly.getVariant} / {@link Toggly.getVariantValue}.
   */
  enableTelemetry?: boolean
  metricsBaseUrl?: string
  telemetryFlushIntervalMs?: number
  enableVariants?: boolean
  localGates?: LocalGate[]
  onError?: (message: string, error?: unknown) => void
}

export interface TogglyService {
  recordUsage(featureKey: string, variant?: string): void
  recordView(featureKey: string, variant?: string): void
  incrementCounter(metricKey: string, value?: number): void
  setGauge(metricKey: string, value: number): void
  flushTelemetry(): Promise<void>
  dispose(): void
  shouldShowFeatureDuringEvaluation: boolean
  init: (options: TogglyOptions) => this
  _loadFeatures: () => Promise<{ [key: string]: boolean } | null>
  _featuresLoaded: () => Promise<{ [key: string]: boolean } | null>
  _evaluateFeatureGate: (
    gate: string[],
    requirement: string,
    negate: boolean,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => Promise<boolean>
  evaluateFeatureGate: (
    featureKeys: string[],
    requirement: string,
    negate: boolean,
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
  getVariant: (featureKey: string) => VariantResult | null
  getVariantValue: (featureKey: string) => unknown | null
  subscribeFeaturesRefresh: (listener: () => void) => () => void
  setLocalGates: (gates: LocalGate[]) => void
  notifyLocalGatesChanged: () => void
  subscribeLocalGatesChanged: (listener: () => void) => () => void
  setContext: (context: TogglyContextUpdate) => Promise<void>
  getEffectiveFlagValue: (
    featureKey: string,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => boolean
  registerContext: <T>(kind: string, mapper: (entity: T) => TogglyEntityContext) => void
}

export class Toggly implements TogglyService {
  private _config: TogglyOptions = {
    baseURI: 'https://definitions.toggly.io',
    verifySignatures: false,
    showFeatureDuringEvaluation: false,
    enableLiveUpdates: true,
    hooks: []
  }
  private readonly _isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'
  private _telemetry?: TelemetryReporter
  private _detachTelemetry?: () => void
  private _disposed = false
  private _generation = 0
  private _features: EvaluatedDefinitions | null = null
  private _variants: { [key: string]: EvaluatedVariantDef } | null = null
  private _loadingFeatures: boolean = false
  private _hookExecutor = new HookExecutor()
  private _featuresRefreshListeners = new Set<() => void>()
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
  private _jwks = new InMemoryJwksCache()

  static readonly FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000

  shouldShowFeatureDuringEvaluation: boolean = false

  /** @internal Identifies a lifecycle so reactive consumers can discard superseded work. */
  get _ownerGeneration(): number { return this._generation }

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
    const appKey = this._config.appKey
    const env = this._config.environment ?? 'Production'
    const scope = this._contextCacheKey()
    if (readCachedFlags(appKey, env, scope) === null ||
      (this._config.enableVariants && readCachedVariants(appKey, env, scope) === null)) return null
    return readCachedRevision(appKey, env, this._revisionScope())
  }

  private _cacheDefinitionsRevision(revision: string | null | undefined): void {
    if (!revision || !this._config.appKey) {
      return
    }
    this._cachedDefinitionsRevision = revision
    if (this._canPersist) {
      writeCachedRevision(this._config.appKey, this._config.environment ?? 'Production', revision, this._revisionScope())
    }
  }

  private _scheduleDebouncedRefresh(forceJwksRefresh = false): void {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer)
    }
    const generation = this._generation
    this._refreshDebounceTimer = setTimeout(() => {
      if (this._disposed || generation !== this._generation) return
      this._refreshDebounceTimer = null
      if (forceJwksRefresh) {
        this._cachedDefinitionsRevision = null
        if (this._config.verifySignatures) {
          this._jwks.clear()
        }
      }
      void this._refreshFeatures()
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

  private _handleWsUpdateMessage(message: WsSyncMessage): void {
    const plan = planFlagsUpdatedRefresh(message, this._definitionsRevision)
    switch (plan.action) {
      case 'refresh-jwks':
        this._scheduleDebouncedRefresh(true)
        break
      case 'refresh-pinned':
        this._pendingDefinitionsPin = plan.pin
        this._cachedDefinitionsRevision = null
        this._scheduleDebouncedRefresh()
        break
      default:
        if (message.etag) {
          this._cacheDefinitionsRevision(message.etag)
        }
        break
    }
  }

  init = (options: TogglyOptions) => {
    this._releaseResources(false)
    this._generation++
    this._disposed = false
    this._loadingFeatures = false
    this._features = null
    this._variants = null
    this._cachedDefinitionsRevision = null
    this._pendingDefinitionsPin = null
    this._jwks = new InMemoryJwksCache()
    this._hookExecutor = new HookExecutor()
    this.setLocalGates([])
    options = { ...options, instanceId: options.instanceId?.trim() || undefined }
    if (!options.appKey) {
      if (options.featureDefaults) {
        this._features = options.featureDefaults ?? {}

        console.warn(
          'Toggly --- Using feature defaults as no application key provided when initializing the Toggly',
        )
      } else {
        console.warn(
          'Toggly --- A valid application key is required to connect to your Toggly.io application for evaluating your features.',
        )
      }
    } else {
      if (!options.environment) {
        options.environment = 'Production'

        console.warn(
          'Toggly --- Using Production environment as no environment provided when initializing the Toggly',
        )
      }
    }

    this._config = { baseURI: 'https://definitions.toggly.io', verifySignatures: false, showFeatureDuringEvaluation: false, enableLiveUpdates: true, hooks: [], ...options }

    this.shouldShowFeatureDuringEvaluation = this._config.showFeatureDuringEvaluation!
    
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

    this.notifyFeaturesRefresh()
    return this
  }

  private _reporter(): TelemetryReporter | undefined {
    if (this._disposed || !this._isBrowser || !this._config.appKey || this._config.enableTelemetry === false) return
    if (!this._telemetry) {
      this._telemetry = createTelemetryReporter({
        appKey: this._config.appKey,
        environment: this._config.environment ?? 'Production',
        identity: this._config.identity,
        instanceId: this._config.instanceId,
        metricsBaseUrl: this._config.metricsBaseUrl,
        telemetryFlushIntervalMs: this._config.telemetryFlushIntervalMs,
        onDiagnostic: diagnostic => {
          try { this._config.onError?.(`Telemetry: ${diagnostic}`) } catch { /* Host diagnostics cannot break evaluation. */ }
        },
      })
      this._detachTelemetry = attachBrowserLifecycle(this._telemetry)
    }
    return this._telemetry
  }

  recordUsage(featureKey: string, variant = 'enabled'): void { this._reporter()?.recordUsage(featureKey, variant) }
  recordView(featureKey: string, variant = 'enabled'): void { this._reporter()?.recordView(featureKey, variant) }
  incrementCounter(metricKey: string, value = 1): void { this._reporter()?.incrementCounter(metricKey, value) }
  setGauge(metricKey: string, value: number): void { this._reporter()?.setGauge(metricKey, value) }
  flushTelemetry(): Promise<void> { return this._telemetry?.flush() ?? Promise.resolve() }

  private _releaseResources(flush = true): void {
    this._detachTelemetry?.()
    this._detachTelemetry = undefined
    this._telemetry?.dispose({flush})
    // Retain the disposed handle so reinit can cancel an in-flight final send.
    if (!flush) this._telemetry = undefined
    this.stopWebSocket()
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._generation++
    this._loadingFeatures = false
    this._releaseResources()
    this._featuresRefreshListeners.clear()
    this._localGatesChangedListeners.clear()
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
    if (this._config.instanceId) return `i:${encodeURIComponent(this._config.instanceId)}`
    const context = this._getEvaluationContext()
    if (!context.groups && !context.claims && !context.identity?.includes('|')) return evaluationContextCacheKey(context)
    return `v2:${encodeURIComponent(JSON.stringify([
      context.identity ?? '', [...(context.groups ?? [])].sort(),
      Object.entries(normalizeEvaluationClaims(context.claims) ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ]))}`
  }

  private _revisionScope(): string {
    return `v2:${this._config.enableVariants ? 'variants' : 'evaluated'}:${this._contextCacheKey()}`
  }

  setContext = async (context: TogglyContextUpdate): Promise<void> => {
    if (this._disposed) return
    this._generation++
    this._loadingFeatures = false
    this.stopWebSocket()
    if (context.identity !== undefined) {
      this._config.identity = context.identity || undefined
      if (context.instanceId === undefined) this._config.instanceId = undefined
    }
    if (context.instanceId !== undefined) this._config.instanceId = context.instanceId.trim() || undefined
    if (context.groups !== undefined) this._groups = [...context.groups]
    if (context.claims !== undefined) this._claims = { ...context.claims }
    this._cachedDefinitionsRevision = null
    this._pendingDefinitionsPin = null
    this._lastFallbackRefresh = 0
    const appKey = this._config.appKey ?? ''
    const env = this._config.environment ?? 'Production'
    const scope = this._contextCacheKey()
    this._variants = this._canPersist && this._config.enableVariants ? readCachedVariants(appKey, env, scope, this._config.maxCacheKeys) : null
    this._features = this._variants ? variantDefsToFlags(this._variants)
      : (this._canPersist ? readCachedFlags(appKey, env, scope, this._config.maxCacheKeys) : null) ?? { ...this._config.featureDefaults }
    this._telemetry?.setContext({instanceId: this._config.instanceId, identity: this._config.identity})
    const generation = this._generation
    this.notifyFeaturesRefresh()
    if (generation !== this._generation || this._disposed) return
    // Failure retains this context and its scoped cache/defaults, never the previous user.
    await this._loadFeatures(true, { strict: true })
  }

  _loadFeatures = async (
    forceRefresh = false,
    options?: { strict?: boolean },
  ) => {
    const generation = this._generation
    if (this._disposed) return this._booleanFeatures()
    // Feature are currently being loaded
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

    if (generation !== this._generation || this._disposed) return null

    // Features already loaded — throttle polling when WebSocket is connected
    if (this._features !== null && !forceRefresh) {
      if (this._wsConnected) {
        const now = Date.now()
        if (now - this._lastFallbackRefresh < Toggly.FALLBACK_REFRESH_INTERVAL) {
          return this._booleanFeatures()
        }
        this._lastFallbackRefresh = now
      }
      return this._booleanFeatures()
    }

    this._loadingFeatures = true

    const isInitialLoad = this._ws === null && !this._wsConnected
    const appKey = this._config.appKey ?? ''
    const env = this._config.environment ?? 'Production'
    const contextKey = this._contextCacheKey()

    try {
      let url = buildEvaluatedSignedUrl(
        this._config.baseURI ?? 'https://definitions.toggly.io',
        appKey,
        env,
        this._getEvaluationContext(),
        Boolean(this._config.enableVariants),
      )

      if (this._config.instanceId) {
        const parsed = new URL(url)
        for (const key of [...parsed.searchParams.keys()]) {
          if (key === 'u' || key === 'userId' || key === 'g' || key.startsWith('claim.')) parsed.searchParams.delete(key)
        }
        parsed.searchParams.set('i', this._config.instanceId)
        url = parsed.toString()
      }
      const pin = this._pendingDefinitionsPin
      this._pendingDefinitionsPin = null
      const fetchUrl = appendDefinitionsRevisionParam(url, pin)

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
      if (generation !== this._generation || this._disposed) return null
      if (loaded.revision) {
        this._cacheDefinitionsRevision(loaded.revision.replace(/^"+|"+$/g, ''))
      }
      if (loaded.notModified) {
        if (isInitialLoad) this.startWebSocket()
        return this._booleanFeatures()
      }
      const parsedDefs = loaded.defs

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
        this._features = (parsedDefs ?? {}) as EvaluatedDefinitions
        if (this._features && this._canPersist) {
          writeCachedFlags(appKey, env, this._features, contextKey, this._config.maxCacheKeys)
        }
      }

      // Trigger afterRefresh hooks
      if (this._features) {
        await this._hookExecutor.executeAfterRefresh(toBooleanDefinitions(this._features))
      }
      if (generation === this._generation && !this._disposed) this.notifyFeaturesRefresh()
    } catch (error) {
      if (generation !== this._generation || this._disposed) return null
      this._reportError('Error fetching feature flags', error)
      if (generation !== this._generation || this._disposed) return null
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
        await this._hookExecutor.executeAfterRefresh(toBooleanDefinitions(this._features))
      }
      if (generation === this._generation && !this._disposed) this.notifyFeaturesRefresh()
    } finally {
      if (generation === this._generation) this._loadingFeatures = false
    }

    // Start WebSocket after initial feature load
    if (isInitialLoad && generation === this._generation && !this._disposed) {
      this.startWebSocket()
    }

    if (generation !== this._generation || this._disposed) return null
    return this._features ? toBooleanDefinitions(this._features) : null
  }

  private _booleanFeatures(): { [key: string]: boolean } | null {
    return this._features ? toBooleanDefinitions(this._features) : null
  }

  _featuresLoaded = async () => {
    if (this._features) {
      return toBooleanDefinitions(this._features)
    }
    return await this._loadFeatures()
  }

  private _captureEvaluation(): EvaluationSnapshot {
    return {owner: this, features: this._features, variants: this._variants, recordCheck: this._reporter()?.captureCheck()}
  }

  private _getEffectiveFlagValue(
    flagKey: string,
    entityContext?: TogglyEntityContext | null,
    snapshot = this._captureEvaluation(),
  ): boolean {
    if (snapshot.owner !== this) return false
    const variant = snapshot.variants?.[flagKey]?.variant || 'enabled'
    const remote = resolveEvaluatedDefinition(snapshot.features?.[flagKey], entityContext)
    const enabled = applyLocalGate(remote, flagKey, this._localGates, this._localGateIndex)
    snapshot.recordCheck?.(flagKey, enabled ? variant : 'disabled')
    return enabled
  }

  _evaluateFeatureGate = async (
    gate: string[], requirement = 'all', negate = false,
    context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string,
    snapshot?: EvaluationSnapshot,
  ) => {
    if (!snapshot) {
      const generation = this._generation
      await this._featuresLoaded()
      if (generation !== this._generation || this._disposed) return false
      snapshot = this._captureEvaluation()
    }
    const captured = snapshot
    if (captured.owner !== this) return false
    const entityContext = normalizeEntityContext(context, kind)
    return evaluateStoredFeatureKeys(captured.features, gate.map(String),
      requirement === 'any' ? 'any' : 'all', negate,
      key => this._getEffectiveFlagValue(key, entityContext, captured))
  }

  evaluateFeatureGate = async (
    featureKeys: string[], requirement = 'all', negate = false,
    context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string,
  ) => {
    const generation = this._generation
    await this._featuresLoaded()
    if (generation !== this._generation || this._disposed) return false
    const snapshot = this._captureEvaluation()
    if (featureKeys.length > 0) {
      const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKeys[0])
      const result = await this._evaluateFeatureGate(featureKeys, requirement, negate, context, kind, snapshot)
      await this._hookExecutor.executeAfterEvaluation(featureKeys[0], dataMap, result)
      return result
    }
    return this._evaluateFeatureGate(featureKeys, requirement, negate, context, kind, snapshot)
  }

  isFeatureOn = async (
    featureKey: string, context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string,
  ) => this.evaluateFeatureGate([featureKey], 'all', false, context, kind)

  isFeatureOff = async (
    featureKey: string, context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string,
  ) => this.evaluateFeatureGate([featureKey], 'all', true, context, kind)

  getEffectiveFlagValue(
    featureKey: string,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): boolean {
    const snapshot = this._captureEvaluation()
    const entityContext = normalizeEntityContext(context, kind)
    return this._getEffectiveFlagValue(featureKey, entityContext, snapshot)
  }

  registerContext = <T>(kind: string, mapper: (entity: T) => TogglyEntityContext): void => {
    registerEntityContext(kind, mapper)
  }

  /**
   * Current variant assignment for a feature (requires {@link TogglyOptions.enableVariants} and loaded data).
   */
  getVariant(featureKey: string): VariantResult | null {
    if (!this._config.enableVariants) {
      return null
    }
    const snapshot = this._captureEvaluation()
    const entry = snapshot.variants?.[featureKey]
    const variant = entry?.variant || 'enabled'
    const enabled = applyLocalGate(entry?.enabled === true, featureKey, this._localGates, this._localGateIndex)
    snapshot.recordCheck?.(featureKey, enabled ? variant : 'disabled')
    if (!enabled || !entry?.variant) return null
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

  /**
   * Subscribe to feature (and variant) data updates after HTTP refresh or WebSocket-driven reload.
   * @returns Unsubscribe function.
   */
  subscribeFeaturesRefresh(listener: () => void): () => void {
    this._featuresRefreshListeners.add(listener)
    return () => {
      this._featuresRefreshListeners.delete(listener)
    }
  }

  private notifyFeaturesRefresh(): void {
    this._featuresRefreshListeners.forEach((listener) => {
      try {
        listener()
      } catch (e) {
        console.error('[Toggly] Error in features refresh listener:', e)
      }
    })
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
  }

  subscribeLocalGatesChanged(listener: () => void): () => void {
    this._localGatesChangedListeners.add(listener)
    return () => {
      this._localGatesChangedListeners.delete(listener)
    }
  }

  startWebSocket() {
    if (this._disposed || !this._isBrowser || !this._config.appKey) {
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
    const generation = this._generation
    const current = () => !this._disposed && generation === this._generation && this._ws === ws

    ws.onopen = () => {
      if (!current()) return
      this._wsConnected = true
      this._wsReconnectAttempt = 0
      this._lastFallbackRefresh = Date.now()
    }

    ws.onmessage = (event) => {
      if (!current()) return
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
        } catch (e) {
          // Unrecognized message, ignore
        }
      }
    }

    ws.onclose = () => {
      if (!current()) return
      this._wsConnected = false
      this._ws = null

      const delay = getNextReconnectDelayMs(this._wsReconnectAttempt)
      this._wsReconnectAttempt += 1
      this._wsReconnectTimer = setTimeout(() => {
        if (this._disposed || generation !== this._generation) return
        this.startWebSocket()
      }, delay)
    }

    ws.onerror = (error) => {
      if (!current()) return
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

  private _refreshFeatures = async () => {
    const generation = this._generation
    await this._loadFeatures(true)
    if (generation !== this._generation || this._disposed) return
    if (this._features && this._canPersist) {
      writeCachedFlags(
        this._config.appKey ?? '',
        this._config.environment ?? 'Production',
        this._features,
        this._contextCacheKey(),
        this._config.maxCacheKeys,
      )
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
}

const toggly = new Toggly()

export default toggly
