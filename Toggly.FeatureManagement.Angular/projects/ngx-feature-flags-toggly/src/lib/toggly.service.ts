import { Injectable, Inject, NgZone, OnDestroy, PLATFORM_ID } from '@angular/core'
import { isPlatformBrowser } from '@angular/common'
import {
  EvaluatedVariantDef,
  ITogglyService,
  VariantResult,
} from './models'
import { TogglyOptions } from './toggly-options'
import { HookExecutor } from './hooks'
import type {
  CacheLruIndex,
  EvaluatedDefinitions,
  Hook,
  TogglyEntityContext,
  TogglyEvaluationContext,
} from '@ops-ai/toggly-hooks-types'
import {
  appendEvaluationContext,
  evaluationContextCacheKey,
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
  bindEvaluationContextChangeState,
  setEvaluationContextSafely,
} from '@ops-ai/toggly-hooks-types'
import {
  applyLocalGate,
  buildFlagGateIndex,
  type FlagGateIndex,
  type LocalGate,
} from '@ops-ai/toggly-local-gates'
import {
  buildWebSocketUrl,
  getNextReconnectDelayMs,
  REFRESH_DEBOUNCE_MS,
  appendDefinitionsRevisionParam,
  applyFlagsUpdatedPlan,
  planFlagsUpdatedRefresh,
  shouldFetchOnSync,
  type FlagsUpdatedRefreshPlan,
  type WsSyncMessage,
} from './ws-sync'
import { buildDefinitionFetchHeaders } from './sdk-identity'
import { InMemoryJwksCache, fetchEvaluatedSignedDefinitions } from '@ops-ai/toggly-signed-defs'

const CACHE_PREFIX_FLAGS = 'toggly:flags:'
const CACHE_PREFIX_VARIANTS = 'toggly:variants:'
const CACHE_PREFIX_REVISION = 'toggly:revision:'
const CACHE_LRU_KEY = 'toggly:cache-lru'

function getFlagsCacheKey(appKey: string, environment: string, contextKey = ''): string {
  const suffix = contextKey ? `:${contextKey}` : ''
  return `${CACHE_PREFIX_FLAGS}${appKey}:${environment}${suffix}`
}

/** Package-local wrapper so Angular's call site differs from React/Vue/Svelte for Sonar CPD. */
function runAngularFlagsUpdatedPlan(
  refreshPlan: FlagsUpdatedRefreshPlan,
  wsMessage: WsSyncMessage,
  onJwks: () => void,
  onPinned: (revisionPin: string | null) => void,
  onRememberEtag: (etagValue: string) => void,
): void {
  applyFlagsUpdatedPlan(refreshPlan, wsMessage, {
    refreshJwks: onJwks,
    refreshPinned: onPinned,
    cacheEtagIfPresent: onRememberEtag,
  })
}

function getVariantsCacheKey(appKey: string, environment: string, contextKey = ''): string {
  const suffix = contextKey ? `:${contextKey}` : ''
  return `${CACHE_PREFIX_VARIANTS}${appKey}:${environment}${suffix}`
}

function getRevisionCacheKey(appKey: string, environment: string): string {
  return `${CACHE_PREFIX_REVISION}${appKey}:${environment}`
}

function boolFlagsFromVariantDefs(
  defs: { [key: string]: EvaluatedVariantDef },
): EvaluatedDefinitions {
  const boolFlags: EvaluatedDefinitions = {}
  for (const [key, entry] of Object.entries(defs)) {
    boolFlags[key] = entry.enabled
  }
  return boolFlags
}

function asEvaluatedDefinitions(raw: unknown): EvaluatedDefinitions {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as EvaluatedDefinitions
  }
  return {}
}

@Injectable({
  providedIn: 'root',
})
export class TogglyService implements ITogglyService, OnDestroy {
  private _features: EvaluatedDefinitions | null = null
  private _variants: { [key: string]: EvaluatedVariantDef } | null = null
  private _loadingFeatures: boolean = false
  private _hookExecutor = new HookExecutor()
  private _isBrowser: boolean
  private _localGates: LocalGate[] = []
  private _localGateIndex: FlagGateIndex = new Map()
  private _localGatesChangedListeners = new Set<() => void>()
  private _featuresRefreshListeners = new Set<() => void>()
  private _lastError: string | undefined
  private _groups: string[] = []
  private _claims: Record<string, string> = {}

  private _ws: WebSocket | null = null
  private _wsConnected = false
  private _wsReconnectTimer: any = null
  private _wsReconnectAttempt = 0
  private _refreshDebounceTimer: any = null
  private _cachedDefinitionsRevision: string | null = null
  _pendingDefinitionsPin: string | null = null
  private _lastFallbackRefresh = 0
  private _webSocketBootstrapped = false
  private _jwks = new InMemoryJwksCache()
  private readonly FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000

  shouldShowFeatureDuringEvaluation: boolean = false

  get lastError(): string | undefined {
    return this._lastError
  }

  private _reportError(message: string, error?: unknown): void {
    this._lastError = message
    this._config.onError?.(message, error)
  }

  private get _canPersist(): boolean {
    return this._isBrowser && this._config.persistCache !== false
  }

  private get _contextCacheKey(): string {
    return evaluationContextCacheKey(this._getEvaluationContext())
  }

  private get _flagsCacheKey(): string {
    return getFlagsCacheKey(
      this._config.appKey ?? '',
      this._config.environment ?? 'Production',
      this._contextCacheKey,
    )
  }

  private get _variantsCacheKey(): string {
    return getVariantsCacheKey(
      this._config.appKey ?? '',
      this._config.environment ?? 'Production',
      this._contextCacheKey,
    )
  }

  private get _revisionCacheKey(): string {
    return getRevisionCacheKey(this._config.appKey ?? '', this._config.environment ?? 'Production')
  }

  private get _definitionsRevision(): string | null {
    if (this._cachedDefinitionsRevision) {
      return this._cachedDefinitionsRevision
    }
    if (!this._canPersist || !this._config.appKey) {
      return null
    }
    return this._readCachedRevision()
  }

  private get _enableVariants(): boolean {
    return this._config.enableVariants === true
  }

  constructor(
    private readonly _config: TogglyOptions,
    private readonly _ngZone: NgZone,
    @Inject(PLATFORM_ID) platformId: object,
  ) {
    this._isBrowser = isPlatformBrowser(platformId)

    if (!this._config.customDefinitionsUrl) {
      if (!this._config.appKey) {
        if (this._config.featureDefaults) {
          this._features = this._config.featureDefaults ?? {}

          console.warn(
            'Toggly --- Using feature defaults as no application key provided when initializing the Toggly',
          )
        } else {
          console.warn(
            'Toggly --- A valid application key is required to connect to your Toggly.io application for evaluating your features.',
          )
        }
      } else {
        if (!this._config.environment) {
          console.warn(
            'Toggly --- Using Production environment as no environment provided when initializing the Toggly',
          )
        }
      }
    }

    this.shouldShowFeatureDuringEvaluation =
      this._config.showFeatureDuringEvaluation ?? false

    // Register initial hooks
    if (this._config.hooks) {
      this._config.hooks.forEach(hook => this._hookExecutor.addHook(hook))
    }

    if (this._config.localGates) {
      this.setLocalGates(this._config.localGates)
    }

    this._groups = this._config.groups ? [...this._config.groups] : []
    this._claims = this._config.claims ? { ...this._config.claims } : {}

    // Seed in-memory state from localStorage for instant availability
    if (this._canPersist) {
      if (this._enableVariants) {
        const cachedVariants = this._readCachedVariants()
        if (cachedVariants && Object.keys(cachedVariants).length > 0) {
          this._applyVariantDefs(cachedVariants)
        }
      }
      if (this._features === null) {
        const cached = this._readCachedFlags()
        if (cached) {
          this._features = cached
        }
      }
    }
  }

  private _applyVariantDefs(defs: { [key: string]: EvaluatedVariantDef }): void {
    this._variants = defs
    this._features = boolFlagsFromVariantDefs(defs)
  }

  private _getEvaluationContext(): TogglyEvaluationContext {
    return {
      identity: this._config.identity || undefined,
      groups: this._groups.length ? [...this._groups] : undefined,
      claims: Object.keys(this._claims).length ? { ...this._claims } : undefined,
    }
  }

  async setContext(context: TogglyEvaluationContext): Promise<void> {
    await setEvaluationContextSafely(
      context,
      (this._config.featureDefaults ?? {}) as EvaluatedDefinitions,
      {
        ...bindEvaluationContextChangeState({
          identity: {
            get: () => this._config.identity,
            set: (value) => {
              this._config.identity = value
            },
          },
          groups: {
            get: () => this._groups,
            set: (value) => {
              this._groups = value
            },
          },
          claims: {
            get: () => this._claims,
            set: (value) => {
              this._claims = value
            },
          },
          features: {
            get: () => this._features,
            set: (value) => {
              this._features = value
            },
          },
          variants: {
            get: () => this._variants,
            set: (value) => {
              this._variants = value
            },
          },
        }),
        notifyRefresh: () => this.notifyFeaturesRefresh(),
        refreshStrict: () => this._loadFeatures(true, { strict: true }),
      },
    )
  }

  private _readCachedFlags(): EvaluatedDefinitions | null {
    if (!this._canPersist) return null
    try {
      const key = this._flagsCacheKey
      const raw = localStorage.getItem(key)
      const parsed = raw ? (JSON.parse(raw) as EvaluatedDefinitions | null) : null
      if (raw != null && parsed != null) {
        this._touchCacheKey(key)
      }
      return parsed
    } catch { return null }
  }

  private _writeCachedFlags(flags: EvaluatedDefinitions): void {
    if (!this._canPersist) return
    try {
      const key = this._flagsCacheKey
      const variantsKey = this._variantsCacheKey
      localStorage.setItem(key, JSON.stringify(flags))
      this._touchCacheKey(key)
      this._enforceMaxCacheKeys([key, variantsKey])
    } catch { /* storage full or unavailable */ }
  }

  private _readCachedVariants(): { [key: string]: EvaluatedVariantDef } | null {
    if (!this._canPersist) return null
    try {
      const key = this._variantsCacheKey
      const raw = localStorage.getItem(key)
      const parsed = raw ? (JSON.parse(raw) as { [key: string]: EvaluatedVariantDef } | null) : null
      if (raw != null && parsed != null) {
        this._touchCacheKey(key)
      }
      return parsed
    } catch { return null }
  }

  private _writeCachedVariants(
    defs: { [key: string]: EvaluatedVariantDef },
  ): void {
    if (!this._canPersist) return
    try {
      const key = this._variantsCacheKey
      const flagsKey = this._flagsCacheKey
      localStorage.setItem(key, JSON.stringify(defs))
      this._touchCacheKey(key)
      this._enforceMaxCacheKeys([flagsKey, key])
    } catch { /* storage full or unavailable */ }
  }

  private _isTrackedCacheKey(key: string): boolean {
    return key.startsWith(CACHE_PREFIX_FLAGS) || key.startsWith(CACHE_PREFIX_VARIANTS)
  }

  private _loadLruIndex(): CacheLruIndex {
    try {
      return parseCacheLruIndex(localStorage.getItem(CACHE_LRU_KEY))
    } catch {
      return parseCacheLruIndex(null)
    }
  }

  private _saveLruIndex(index: CacheLruIndex): void {
    try {
      localStorage.setItem(CACHE_LRU_KEY, serializeCacheLruIndex(index))
    } catch { /* storage full or unavailable */ }
  }

  private _touchCacheKey(key: string): void {
    if (!this._canPersist || !isCacheLruEnabled(this._config.maxCacheKeys)) {
      return
    }
    if (!this._isTrackedCacheKey(key)) {
      return
    }
    try {
      this._saveLruIndex(touchCacheLruKey(this._loadLruIndex(), key))
    } catch { /* ignore LRU failures */ }
  }

  private _enforceMaxCacheKeys(protectKeys: string[]): void {
    const maxKeys = this._config.maxCacheKeys
    if (!this._canPersist || !isCacheLruEnabled(maxKeys)) {
      return
    }
    try {
      let index = this._loadLruIndex()
      const toEvict = selectCacheLruKeysToEvict(index, maxKeys as number, { protectKeys }).filter(
        (key: string) => this._isTrackedCacheKey(key),
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
      this._saveLruIndex(index)
    } catch { /* ignore LRU failures */ }
  }

  private _removeCacheKeysFromLruIndex(keys: string[]): void {
    if (!this._canPersist || !isCacheLruEnabled(this._config.maxCacheKeys)) {
      return
    }
    try {
      this._saveLruIndex(removeCacheLruKeys(this._loadLruIndex(), keys))
    } catch { /* ignore LRU failures */ }
  }

  /**
   * Clear current identity-scoped flags/variants localStorage entries and update the LRU index.
   */
  clearFeatureFlagsCache(): void {
    if (!this._canPersist || !this._config.appKey) {
      this._features = null
      this._variants = null
      return
    }
    try {
      const flagsKey = this._flagsCacheKey
      const variantsKey = this._variantsCacheKey
      const revisionKey = this._revisionCacheKey
      localStorage.removeItem(flagsKey)
      localStorage.removeItem(variantsKey)
      localStorage.removeItem(revisionKey)
      this._removeCacheKeysFromLruIndex([flagsKey, variantsKey])
    } catch { /* ignore */ }
    this._features = null
    this._variants = null
  }

  private _readCachedRevision(): string | null {
    if (!this._canPersist) return null
    try {
      return localStorage.getItem(this._revisionCacheKey)
    } catch { return null }
  }

  private _writeCachedRevision(revision: string): void {
    if (!this._canPersist) return
    try {
      localStorage.setItem(this._revisionCacheKey, revision)
    } catch { /* storage full or unavailable */ }
  }

  private _cacheDefinitionsRevision(revision: string | null | undefined): void {
    if (!revision || !this._config.appKey) {
      return
    }
    this._cachedDefinitionsRevision = revision
    if (this._canPersist) {
      this._writeCachedRevision(revision)
    }
  }

  private _scheduleDebouncedRefresh(forceJwksRefresh = false): void {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer)
    }
    this._refreshDebounceTimer = setTimeout(() => {
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
    runAngularFlagsUpdatedPlan(
      planFlagsUpdatedRefresh(message, this._definitionsRevision),
      message,
      () => this._scheduleDebouncedRefresh(true),
      (revisionPin) => {
        this._pendingDefinitionsPin = revisionPin
        this._cachedDefinitionsRevision = null
        this._scheduleDebouncedRefresh()
      },
      (etagValue) => this._cacheDefinitionsRevision(etagValue),
    )
  }

  private _refreshFeatures = async (): Promise<void> => {
    const flags = await this._loadFeatures(true)
    if (flags) {
      this._writeCachedFlags(flags)
      if (this._enableVariants && this._variants) {
        this._writeCachedVariants(this._variants)
      }
    }
  }

  private _loadFeatures = async (
    forceRefresh = false,
    options?: { strict?: boolean },
  ) => {
    // Feature are currently being loaded
    if (this._loadingFeatures) {
      await new Promise<void>((resolve) => {
        const checkIfApiCallFinished = () => {
          if (!this._loadingFeatures) {
            resolve()
          } else {
            setTimeout(checkIfApiCallFinished, 100)
          }
        }
        checkIfApiCallFinished()
      })
    }

    // Features already loaded — apply polling throttle when WS is connected
    if (this._features !== null && !forceRefresh) {
      if (this._wsConnected) {
        const now = Date.now()
        if (now - this._lastFallbackRefresh < this.FALLBACK_REFRESH_INTERVAL) {
          return this._features
        }
      } else {
        return this._features
      }
    }

    this._loadingFeatures = true

    try {
      const base = this._config.baseURI ?? 'https://definitions.toggly.io'
      const env = this._config.environment ?? 'Production'
      const appKey = this._config.appKey ?? ''

      let url: string
      let useVariantResponse: boolean

      if (this._config.customDefinitionsUrl) {
        useVariantResponse = this._enableVariants
        const customUrl = new URL(this._config.customDefinitionsUrl)
        appendEvaluationContext(
          customUrl,
          this._getEvaluationContext(),
          useVariantResponse ? 'variants' : 'evaluated',
        )
        url = customUrl.toString()
      } else if (this._enableVariants) {
        useVariantResponse = true
        const fetchUrl = new URL(`${base}/evaluated-variants-signed/${appKey}/${env}`)
        appendEvaluationContext(fetchUrl, this._getEvaluationContext(), 'variants')
        url = fetchUrl.toString()
      } else {
        useVariantResponse = false
        const fetchUrl = new URL(`${base}/evaluated-signed/${appKey}/${env}`)
        appendEvaluationContext(fetchUrl, this._getEvaluationContext(), 'evaluated')
        url = fetchUrl.toString()
      }

      const pin = this._pendingDefinitionsPin
      this._pendingDefinitionsPin = null
      const pinnedUrl = appendDefinitionsRevisionParam(url, pin)

      const loaded = await fetchEvaluatedSignedDefinitions(
        pinnedUrl,
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
      if (loaded.revision) {
        this._cacheDefinitionsRevision(loaded.revision.replace(/^"+|"+$/g, ''))
      }
      if (loaded.notModified) {
        this._lastFallbackRefresh = Date.now()
        return this._features
      }
      const raw = loaded.defs

      this._lastFallbackRefresh = Date.now()

      if (useVariantResponse) {
        const defs = raw as unknown as { [key: string]: EvaluatedVariantDef }
        this._applyVariantDefs(defs)
        if (this._features) {
          this._writeCachedVariants(defs)
          this._writeCachedFlags(this._features)
          this._hookExecutor.executeAfterRefresh(toBooleanDefinitions(this._features))
        }
      } else {
        this._variants = null
        this._features = asEvaluatedDefinitions(raw)
        if (this._features) {
          this._writeCachedFlags(this._features)
          this._hookExecutor.executeAfterRefresh(toBooleanDefinitions(this._features))
        }
      }
    } catch (error) {
      this._reportError('Error fetching feature flags', error)
      if (this._enableVariants) {
        const cachedVariants = this._readCachedVariants()
        if (cachedVariants && Object.keys(cachedVariants).length > 0) {
          this._applyVariantDefs(cachedVariants)
        } else if (this._features === null) {
          const cached = this._readCachedFlags()
          this._variants = null
          this._features = cached ?? this._config.featureDefaults ?? {}
        }
      } else {
        if (this._features === null) {
          const cached = this._readCachedFlags()
          this._features = cached ?? this._config.featureDefaults ?? {}
        }
      }
      if (options?.strict) {
        throw error
      }
      console.warn(
        'Toggly --- Using cached/default features as features could not be loaded from the Toggly API',
      )
    } finally {
      this._loadingFeatures = false
    }

    this.notifyFeaturesRefresh()

    return this._features
  }

  private _featuresLoaded = async () => {
    if (this._features === null) {
      await this._loadFeatures()
    }
    this._ensureWebSocketBootstrapped()
    return this._features
  }

  /**
   * Start the live-update WebSocket once feature state is available (network or cache).
   */
  private _ensureWebSocketBootstrapped(): void {
    if (this._webSocketBootstrapped || !this._config.appKey) {
      return
    }
    if (this._features === null) {
      return
    }
    this._webSocketBootstrapped = true
    this.startWebSocket()
  }

  private _getEffectiveFlagValue(
    flagKey: string,
    entityContext?: TogglyEntityContext | null,
  ): boolean {
    const remote = resolveEvaluatedDefinition(this._features?.[flagKey], entityContext)
    return applyLocalGate(remote, flagKey, this._localGates, this._localGateIndex)
  }

  private _evaluateFeatureGate = async (
    gate: string[],
    requirement = 'all',
    negate = false,
    entityContext?: TogglyEntityContext | null,
  ) => {
    await this._featuresLoaded()

    return evaluateStoredFeatureKeys(
      this._features,
      gate.map(String),
      requirement === 'any' ? 'any' : 'all',
      negate,
      (key) => this._getEffectiveFlagValue(key, entityContext),
    )
  }

  evaluateFeatureGate = async (
    featureKeys: string[],
    requirement = 'all',
    negate = false,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => {
    const entityContext = normalizeEntityContext(context, kind)
    if (featureKeys.length > 0) {
      const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKeys[0])
      const result = await this._evaluateFeatureGate(
        featureKeys,
        requirement,
        negate,
        entityContext,
      )
      await this._hookExecutor.executeAfterEvaluation(featureKeys[0], dataMap, result)
      return result
    }
    return await this._evaluateFeatureGate(featureKeys, requirement, negate, entityContext)
  }

  isFeatureOn = async (
    featureKey: string,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => {
    const entityContext = normalizeEntityContext(context, kind)
    const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKey)
    const result = await this._evaluateFeatureGate([featureKey], 'all', false, entityContext)
    await this._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result)
    return result
  }

  registerContext<T>(kind: string, mapper: (entity: T) => TogglyEntityContext): void {
    registerEntityContext(kind, mapper)
  }

  isFeatureOff = async (featureKey: string) => {
    const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKey)
    const result = await this._evaluateFeatureGate([featureKey], 'all', true)
    await this._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result)
    return result
  }

  /**
   * Returns the assigned variant for a feature, or null if variants are disabled,
   * not loaded, or no variant is assigned.
   */
  getVariant = async (featureKey: string): Promise<VariantResult | null> => {
    if (!this._enableVariants) {
      return null
    }
    await this._featuresLoaded()
    const variants = this._variants
    if (!variants) {
      return null
    }
    const entry = variants[featureKey]
    if (!entry?.variant) {
      return null
    }
    if (!applyLocalGate(entry.enabled === true, featureKey, this._localGates, this._localGateIndex)) {
      return null
    }
    return {
      name: entry.variant,
      configurationValue: entry.configurationValue,
    }
  }

  /**
   * Returns the configuration value of the assigned variant, or null if none.
   */
  getVariantValue = async (featureKey: string): Promise<unknown | null> => {
    const variant = await this.getVariant(featureKey)
    return variant?.configurationValue ?? null
  }

  /**
   * Add a hook dynamically
   */
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

  setLocalGates(gates: LocalGate[]): void {
    this._localGates = [...gates]
    this._localGateIndex = buildFlagGateIndex(this._localGates)
  }

  notifyLocalGatesChanged(): void {
    this._localGatesChangedListeners.forEach((listener) => {
      try {
        listener()
      } catch (err) {
        console.error('[Toggly] Local gate listener error:', err)
      }
    })
  }

  subscribeLocalGatesChanged(listener: () => void): () => void {
    this._localGatesChangedListeners.add(listener)
    return () => {
      this._localGatesChangedListeners.delete(listener)
    }
  }

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

  private startWebSocket(): void {
    if (!this._config.appKey) {
      return
    }

    this.stopWebSocket()

    const wsUrl = buildWebSocketUrl(
      this._config.baseURI ?? 'https://definitions.toggly.io',
      this._config.appKey,
      this._definitionsRevision,
    )

    try {
      this._ws = new WebSocket(wsUrl)
    } catch (error) {
      console.warn('Toggly --- Failed to create WebSocket connection', error)
      return
    }

    this._ws.onopen = () => {
      this._ngZone.run(() => {
        this._wsConnected = true
        this._wsReconnectAttempt = 0
        this._lastFallbackRefresh = Date.now()
      })
    }

    this._ws.onmessage = (event: MessageEvent) => {
      this._ngZone.run(() => {
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
            if (
              message.type === 'flags-updated' ||
              message.type === 'update' ||
              message.type === 'signing-key-updated'
            ) {
              this._handleWsUpdateMessage(message)
            }
          } catch (error) {
            console.warn('Toggly --- Failed to parse WebSocket message', error)
          }
        }
      })
    }

    this._ws.onclose = () => {
      this._ngZone.run(() => {
        this._wsConnected = false
        this._ws = null

        const delay = getNextReconnectDelayMs(this._wsReconnectAttempt)
        this._wsReconnectAttempt += 1
        this._wsReconnectTimer = setTimeout(() => {
          this.startWebSocket()
        }, delay)
      })
    }

    this._ws.onerror = (error: Event) => {
      console.warn('Toggly --- WebSocket error', error)
    }
  }

  private stopWebSocket(): void {
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

  ngOnDestroy(): void {
    this.stopWebSocket()
  }
}
