import type { Hook, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import { appendEvaluationContext, evaluationContextCacheKey } from '@ops-ai/toggly-hooks-types';
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

export type { EvaluatedVariantDef, VariantResult } from './variant.types';

const canUseStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
const CACHE_PREFIX = 'toggly:flags:'
const VARIANTS_CACHE_PREFIX = 'toggly:variants:'
const REVISION_CACHE_PREFIX = 'toggly:revision:'

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

function readCachedFlags(appKey: string, environment: string, contextKey = ''): { [key: string]: boolean } | null {
  if (!canUseStorage) return null
  try {
    const raw = localStorage.getItem(getCacheKey(appKey, environment, contextKey))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeCachedFlags(
  appKey: string,
  environment: string,
  flags: { [key: string]: boolean },
  contextKey = '',
): void {
  if (!canUseStorage) return
  try {
    localStorage.setItem(getCacheKey(appKey, environment, contextKey), JSON.stringify(flags))
  } catch { /* storage full or unavailable */ }
}

function readCachedVariants(
  appKey: string,
  environment: string,
  contextKey = '',
): { [key: string]: EvaluatedVariantDef } | null {
  if (!canUseStorage) return null
  try {
    const raw = localStorage.getItem(getVariantsCacheKey(appKey, environment, contextKey))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeCachedVariants(
  appKey: string,
  environment: string,
  variants: { [key: string]: EvaluatedVariantDef },
  contextKey = '',
): void {
  if (!canUseStorage) return
  try {
    localStorage.setItem(getVariantsCacheKey(appKey, environment, contextKey), JSON.stringify(variants))
  } catch { /* storage full or unavailable */ }
}

export interface TogglyOptions {
  baseURI?: string
  verifySignatures?: boolean
  appKey?: string
  environment?: string
  identity?: string
  groups?: string[]
  claims?: Record<string, string>
  featureDefaults?: { [key: string]: boolean }
  showFeatureDuringEvaluation?: boolean
  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[]
  /** Enable WebSocket live updates (defaults to true when appKey is set) */
  enableLiveUpdates?: boolean
  /** Enable localStorage caching of definitions. Default: true. Set false for SSR-only or privacy-sensitive contexts. */
  persistCache?: boolean
  /**
   * Use /evaluated-variants-signed and expose {@link Toggly.getVariant} / {@link Toggly.getVariantValue}.
   * Matches @ops-ai/feature-flags-toggly when enableVariants is true.
   */
  enableVariants?: boolean
  /** Device-local gates applied as a read-time AND on worker-evaluated booleans */
  localGates?: LocalGate[]
  /** Optional SDK error callback for reporting fetch/cache/evaluation failures. */
  onError?: (message: string, error?: unknown) => void
}

export interface TogglyService {
  shouldShowFeatureDuringEvaluation: boolean
  _loadFeatures: () => Promise<{ [key: string]: boolean } | null>
  _featuresLoaded: () => Promise<{ [key: string]: boolean } | null>
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
  getVariant: (featureKey: string) => VariantResult | null
  getVariantValue: (featureKey: string) => unknown | null
  subscribeFeaturesRefresh: (listener: () => void) => () => void
  setLocalGates: (gates: LocalGate[]) => void
  notifyLocalGatesChanged: () => void
  subscribeLocalGatesChanged: (listener: () => void) => () => void
  setContext: (context: TogglyEvaluationContext) => Promise<void>
}

export class Toggly implements TogglyService {
  private _config: TogglyOptions = {
    baseURI: 'https://definitions.toggly.io',
    verifySignatures: false,
    showFeatureDuringEvaluation: false,
    hooks: []
  }
  private _features: { [key: string]: boolean } | null = null
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
  _wsReconnectTimer: any = null
  _wsReconnectAttempt = 0
  _refreshDebounceTimer: any = null
  _cachedDefinitionsRevision: string | null = null
  _lastFallbackRefresh: number = 0

  static readonly FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000

  shouldShowFeatureDuringEvaluation: boolean = false

  get lastError(): string | undefined {
    return this._lastError
  }

  private _reportError(message: string, error?: unknown): void {
    this._lastError = message
    this._config.onError?.(message, error)
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
      const contextKey = evaluationContextCacheKey({
        identity: this._config.identity,
        groups: this._groups.length ? this._groups : undefined,
        claims: Object.keys(this._claims).length ? this._claims : undefined,
      })
      if (this._config.enableVariants) {
        const vCached = readCachedVariants(appKey, env, contextKey)
        if (vCached) {
          this._variants = vCached
          this._features = variantDefsToFlags(vCached)
        }
      }
      if (this._features === null) {
        const cached = readCachedFlags(appKey, env, contextKey)
        if (cached) {
          this._features = cached
        }
      }
    }
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
      }
      void this._refreshFeatures()
    }, REFRESH_DEBOUNCE_MS)
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

    // Features already loaded
    if (this._features !== null && !forceRefresh) {
      // When WebSocket is connected, throttle HTTP refreshes to fallback interval
      if (this._wsConnected) {
        const now = Date.now()
        if (now - this._lastFallbackRefresh < Toggly.FALLBACK_REFRESH_INTERVAL) {
          return this._features
        }
        this._lastFallbackRefresh = now
      }

      return this._features
    }

    this._loadingFeatures = true

    const isInitialLoad = this._ws === null && !this._wsConnected

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
        return this._features
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch feature flags: ${response.status} ${response.statusText}`)
      }
      const payload = await response.json()

      if (this._config.enableVariants) {
        const rawDefs = payload?.defs ?? payload
        const defs =
          rawDefs && typeof rawDefs === 'object' && !Array.isArray(rawDefs)
            ? (rawDefs as { [key: string]: EvaluatedVariantDef })
            : {}
        this._variants = defs
        this._features = variantDefsToFlags(defs)
        if (this._features && this._canPersist) {
          writeCachedVariants(appKey, env, defs, contextKey)
          writeCachedFlags(appKey, env, this._features, contextKey)
        }
      } else {
        this._variants = null
        this._features = payload?.defs ?? payload
        if (this._features && this._canPersist) {
          writeCachedFlags(appKey, env, this._features, contextKey)
        }
      }

      if (this._features) {
        await this._hookExecutor.executeAfterRefresh(this._features)
      }
      this.notifyFeaturesRefresh()
    } catch (error) {
      this._reportError('Error fetching feature flags', error)
      if (this._config.enableVariants) {
        const vCached = this._canPersist ? readCachedVariants(appKey, env, contextKey) : null
        if (vCached) {
          this._variants = vCached
          this._features = variantDefsToFlags(vCached)
        } else if (this._features === null) {
          this._variants = null
          const cached = this._canPersist ? readCachedFlags(appKey, env, contextKey) : null
          this._features = cached ?? this._config.featureDefaults ?? {}
        }
      } else {
        if (this._features === null) {
          this._variants = null
          const cached = this._canPersist ? readCachedFlags(appKey, env, contextKey) : null
          this._features = cached ?? this._config.featureDefaults ?? {}
        }
      }
      console.warn(
        'Toggly --- Using cached/default features as features could not be loaded from the Toggly API',
      )
      if (this._features) {
        await this._hookExecutor.executeAfterRefresh(this._features)
      }
      this.notifyFeaturesRefresh()
    } finally {
      this._loadingFeatures = false
    }

    // Start WebSocket live updates after initial feature load
    if (isInitialLoad) {
      this.startWebSocket()
    }

    return this._features
  }

  _featuresLoaded = async () => {
    return this._features ?? (await this._loadFeatures())
  }

  private _getEffectiveFlagValue(flagKey: string): boolean {
    const remote = this._features?.[flagKey] === true
    return applyLocalGate(remote, flagKey, this._localGates, this._localGateIndex)
  }

  _evaluateFeatureGate = async (
    gate: string[],
    requirement = 'all',
    negate = false,
  ) => {
    await this._featuresLoaded()

    if (gate.length > 0 && (!this._features || Object.keys(this._features).length === 0)) {
      return negate
    }

    var isEnabled: boolean

    if (requirement === 'any') {
      isEnabled = gate.reduce((isEnabled: any, featureKey: string | number) => {
        return (
          isEnabled ||
          this._getEffectiveFlagValue(String(featureKey))
        )
      }, false)
    } else {
      isEnabled = gate.reduce((isEnabled: any, featureKey: string | number) => {
        return (
          isEnabled &&
          this._getEffectiveFlagValue(String(featureKey))
        )
      }, true)
    }

    isEnabled = negate ? !isEnabled : isEnabled

    return isEnabled
  }

  evaluateFeatureGate = async (
    featureKeys: string[],
    requirement = 'all',
    negate = false,
  ) => {
    if (featureKeys.length > 0) {
      const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKeys[0]);
      const result = await this._evaluateFeatureGate(featureKeys, requirement, negate);
      await this._hookExecutor.executeAfterEvaluation(featureKeys[0], dataMap, result);
      return result;
    }
    return await this._evaluateFeatureGate(featureKeys, requirement, negate);
  }

  isFeatureOn = async (featureKey: string) => {
    const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKey)
    const result = await this._evaluateFeatureGate([featureKey])
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
   * Current variant assignment for a feature (requires {@link TogglyOptions.enableVariants} and loaded data).
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

  startWebSocket = () => {
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
        } catch (e) {
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

  stopWebSocket = () => {
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

  /**
   * Force-refresh features from the API (bypasses the loaded cache).
   * Used by WebSocket handlers to pull fresh definitions on update signals.
   */
  private _refreshFeatures = async () => {
    const flags = await this._loadFeatures(true)
    if (flags && this._canPersist) {
      writeCachedFlags(
        this._config.appKey ?? '',
        this._config.environment ?? 'Production',
        flags,
        this._contextCacheKey(),
      )
    }
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
}

export default Toggly
