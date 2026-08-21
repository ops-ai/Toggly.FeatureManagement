import type { CacheLruIndex, EvaluatedDefinitions, Hook, TogglyEntityContext, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import {
  appendEvaluationContext,
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
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  REFRESH_DEBOUNCE_MS,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  shouldFetchOnSync,
  type WsSyncMessage,
} from '../utils/ws-sync';
import { buildDefinitionFetchHeaders } from '../utils/sdk-identity'
import {
  parseDefinitionsFromRaw,
  parseSignedEnvelope,
  verifySignedDefinitions,
  type JwkSet,
} from '../utils/signed-defs-verify'

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

function getRevisionCacheKey(appKey: string, environment: string): string {
  return `${REVISION_CACHE_PREFIX}${appKey}:${environment}`
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
    const revisionKey = getRevisionCacheKey(appKey, environment)
    localStorage.removeItem(flagsKey)
    localStorage.removeItem(variantsKey)
    localStorage.removeItem(revisionKey)
    removeCacheKeysFromLruIndex([flagsKey, variantsKey], maxCacheKeys)
  } catch { /* ignore */ }
}

function readCachedRevision(appKey: string, environment: string): string | null {
  if (!canUseStorage) return null
  try {
    return localStorage.getItem(getRevisionCacheKey(appKey, environment))
  } catch { return null }
}

function writeCachedRevision(appKey: string, environment: string, revision: string): void {
  if (!canUseStorage) return
  try {
    localStorage.setItem(getRevisionCacheKey(appKey, environment), revision)
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
  ) => Promise<boolean>
  evaluateFeatureGate: (
    featureKeys: string[],
    requirement: string,
    negate: boolean,
  ) => Promise<boolean>
  isFeatureOn: (featureKey: string) => Promise<boolean>
  isFeatureOff: (featureKey: string) => Promise<boolean>
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
  setContext: (context: TogglyEvaluationContext) => Promise<void>
  getEffectiveFlagValue: (featureKey: string) => boolean
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
  _lastFallbackRefresh: number = 0
  private _fallbackRefreshInterval: number = 20 * 60 * 1000
  private _inMemoryJwks: JwkSet | null = null

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
    return readCachedRevision(this._config.appKey, this._config.environment ?? 'Production')
  }

  private _cacheDefinitionsRevision(revision: string | null | undefined): void {
    if (!revision || !this._config.appKey) {
      return
    }
    this._cachedDefinitionsRevision = revision
    if (this._canPersist) {
      writeCachedRevision(this._config.appKey, this._config.environment ?? 'Production', revision)
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
          this._inMemoryJwks = null
        }
      }
      void this.refreshFlags()
    }, REFRESH_DEBOUNCE_MS)
  }

  private async _fetchJwks(forceRefresh = false): Promise<JwkSet> {
    if (!forceRefresh && this._inMemoryJwks) {
      return this._inMemoryJwks
    }
    const response = await fetch(`${this._config.baseURI}/.well-known/jwks`, {
      headers: buildDefinitionFetchHeaders(),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch JWKs: ${response.status} ${response.statusText}`)
    }
    const jwks = (await response.json()) as JwkSet
    this._inMemoryJwks = jwks
    return jwks
  }

  /**
   * Parse evaluated-signed body. When verifySignatures is enabled, verify ES256
   * against the exact raw defs JSON (Web Crypto double-hash).
   */
  private async _readResponseBody(response: Response): Promise<string> {
    if (typeof response.text === 'function') {
      return response.text()
    }
    return JSON.stringify(await response.json())
  }

  private async _parseEvaluatedSignedBody(bodyText: string): Promise<{ defs: unknown }> {
    if (!this._config.verifySignatures) {
      const payload = JSON.parse(bodyText) as { defs?: unknown }
      return { defs: payload?.defs ?? payload }
    }
    const { envelope, defsRaw } = parseSignedEnvelope(bodyText)
    const jwks = await this._fetchJwks()
    await verifySignedDefinitions(
      defsRaw,
      {
        signature: envelope.signature,
        timestamp: envelope.timestamp,
        kid: envelope.kid,
      },
      jwks,
      this._config.allowedKeyIds,
      { maxSignatureAgeSeconds: this._config.maxSignatureAgeSeconds },
    )
    return { defs: parseDefinitionsFromRaw(defsRaw) }
  }

  private _handleWsSyncMessage(message: WsSyncMessage): void {
    const previousRevision = this._definitionsRevision
    if (shouldFetchOnSync(message, previousRevision)) {
      this._scheduleDebouncedRefresh()
    }
    if (message.etag) {
      this._cacheDefinitionsRevision(message.etag)
    }
  }

  private _handleWsUpdateMessage(message: WsSyncMessage): void {
    if (shouldFetchOnSigningKeyUpdated(message)) {
      this._scheduleDebouncedRefresh(true)
      return
    }
    const previousRevision = this._definitionsRevision
    if (shouldFetchOnFlagsUpdated(message, previousRevision)) {
      this._scheduleDebouncedRefresh()
    }
    if (message.etag) {
      this._cacheDefinitionsRevision(message.etag)
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
      const contextKey = evaluationContextCacheKey({
        identity: this._config.identity,
        groups: this._groups.length ? this._groups : undefined,
        claims: Object.keys(this._claims).length ? this._claims : undefined,
      })
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
    return evaluationContextCacheKey(this._getEvaluationContext())
  }

  setContext = async (context: TogglyEvaluationContext): Promise<void> => {
    if (context.identity !== undefined) {
      this._config.identity = context.identity || undefined
    }
    if (context.groups !== undefined) {
      this._groups = [...context.groups]
    }
    if (context.claims !== undefined) {
      this._claims = { ...context.claims }
    }
    this._features = null
    this._variants = null
    await this._loadFeatures(true)
  }

  _loadFeatures = async (forceRefresh = false) => {
    // Features are currently being loaded
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
      let url: string
      if (this._config.enableVariants) {
        const fetchUrl = new URL(`${this._config.baseURI}/evaluated-variants-signed/${appKey}/${env}`)
        appendEvaluationContext(fetchUrl, this._getEvaluationContext(), 'variants')
        url = fetchUrl.toString()
      } else {
        const fetchUrl = new URL(`${this._config.baseURI}/evaluated-signed/${appKey}/${env}`)
        appendEvaluationContext(fetchUrl, this._getEvaluationContext(), 'evaluated')
        url = fetchUrl.toString()
      }

      const revision = this._definitionsRevision
      const headers: HeadersInit = buildDefinitionFetchHeaders(
        revision ? { 'If-None-Match': revision } : {},
      )

      const response = await fetch(url, { headers })
      const responseRevision = extractDefinitionsRevision(response)
      if (responseRevision) {
        this._cacheDefinitionsRevision(responseRevision.replace(/^"+|"+$/g, ''))
      }
      if (response.status === 304) {
        this._lastFetchTime = Date.now()
        return this._features
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch feature flags: ${response.status} ${response.statusText}`)
      }
      const bodyText = await this._readResponseBody(response)
      const { defs: parsedDefs } = await this._parseEvaluatedSignedBody(bodyText)
      this._lastFetchTime = Date.now()

      if (this._config.enableVariants) {
        const defs =
          parsedDefs && typeof parsedDefs === 'object' && !Array.isArray(parsedDefs)
            ? (parsedDefs as { [key: string]: EvaluatedVariantDef })
            : {}
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

      if (this._features) {
        this._hookExecutor.executeAfterRefresh(toBooleanDefinitions(this._features))
      }
    } catch (error) {
      this._reportError('Error fetching feature flags', error)
      if (this._config.enableVariants) {
        const vCached = this._canPersist ? readCachedVariants(appKey, env, contextKey, this._config.maxCacheKeys) : null
        if (vCached) {
          this._variants = vCached
          this._features = variantDefsToFlags(vCached)
        } else if (this._features === null) {
          this._variants = null
          const cached = this._canPersist ? readCachedFlags(appKey, env, contextKey, this._config.maxCacheKeys) : null
          this._features = cached ?? this._config.featureDefaults ?? {}
        }
      } else {
        if (this._features === null) {
          this._variants = null
          const cached = this._canPersist ? readCachedFlags(appKey, env, contextKey, this._config.maxCacheKeys) : null
          this._features = cached ?? this._config.featureDefaults ?? {}
        }
      }
      console.warn(
        'Toggly --- Using cached/default features as features could not be loaded from the Toggly API',
      )
      if (this._features) {
        this._hookExecutor.executeAfterRefresh(toBooleanDefinitions(this._features))
      }
    } finally {
      this._loadingFeatures = false
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
    const remote = resolveEvaluatedDefinition(this._features?.[featureKey], entityContext)
    return applyLocalGate(remote, featureKey, this._localGates, this._localGateIndex)
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

    return evaluateStoredFeatureKeys(
      this._features,
      gate.map(String),
      requirement === 'any' ? 'any' : 'all',
      negate,
      (key) => this.getEffectiveFlagValue(key, entityContext),
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
    // For gate evaluation, we call hooks with the first key as representative
    // This is a simplified approach - gates evaluate multiple flags together
    if (featureKeys.length > 0) {
      const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKeys[0])
      const result = await this._evaluateFeatureGate(featureKeys, requirement, negate, entityContext)
      await this._hookExecutor.executeAfterEvaluation(featureKeys[0], dataMap, result)
      return result
    }
    return await this._evaluateFeatureGate(featureKeys, requirement, negate)
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

  isFeatureOff = async (featureKey: string) => {
    const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKey)
    const result = await this._evaluateFeatureGate([featureKey], 'all', true)
    await this._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result)
    return result
  }

  /**
   * Current variant assignment for a feature (requires enableVariants and loaded data).
   */
  getVariant(featureKey: string): VariantResult | null {
    if (!this._config.enableVariants) {
      return null
    }
    const variants = this._variants
    if (!variants) {
      return null
    }
    const entry = variants[featureKey]
    if (!entry || !entry.variant) {
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
    const flags = await this._loadFeatures(true)
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
    if (!this._config.appKey) {
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
}

export default Toggly
