import type { Hook } from '@ops-ai/toggly-hooks-types';
import { HookExecutor } from './hooks';
import type { EvaluatedVariantDef, VariantResult } from '../variant.types';

export type { EvaluatedVariantDef, VariantResult } from '../variant.types';

const canUseStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
const CACHE_PREFIX = 'toggly:flags:'
const VARIANTS_CACHE_PREFIX = 'toggly:variants:'

function getCacheKey(appKey: string, environment: string): string {
  return `${CACHE_PREFIX}${appKey}:${environment}`
}

function getVariantsCacheKey(appKey: string, environment: string): string {
  return `${VARIANTS_CACHE_PREFIX}${appKey}:${environment}`
}

function variantDefsToFlags(defs: { [key: string]: EvaluatedVariantDef }): { [key: string]: boolean } {
  const out: { [key: string]: boolean } = {}
  for (const key of Object.keys(defs)) {
    out[key] = defs[key]?.enabled === true
  }
  return out
}

function readCachedFlags(appKey: string, environment: string): { [key: string]: boolean } | null {
  if (!canUseStorage) return null
  try {
    const raw = localStorage.getItem(getCacheKey(appKey, environment))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeCachedFlags(appKey: string, environment: string, flags: { [key: string]: boolean }): void {
  if (!canUseStorage) return
  try {
    localStorage.setItem(getCacheKey(appKey, environment), JSON.stringify(flags))
  } catch { /* storage full or unavailable */ }
}

function readCachedVariants(appKey: string, environment: string): { [key: string]: EvaluatedVariantDef } | null {
  if (!canUseStorage) return null
  try {
    const raw = localStorage.getItem(getVariantsCacheKey(appKey, environment))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeCachedVariants(
  appKey: string,
  environment: string,
  variants: { [key: string]: EvaluatedVariantDef },
): void {
  if (!canUseStorage) return
  try {
    localStorage.setItem(getVariantsCacheKey(appKey, environment), JSON.stringify(variants))
  } catch { /* storage full or unavailable */ }
}

export interface TogglyOptions {
  baseURI?: string
  verifySignatures?: boolean
  appKey?: string
  environment?: string
  identity?: string
  featureDefaults?: { [key: string]: boolean }
  showFeatureDuringEvaluation?: boolean
  /** Enable live updates via WebSocket (defaults to true) */
  enableLiveUpdates?: boolean
  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[]
  /** Enable localStorage caching of definitions. Default: true. Set false for SSR-only or privacy-sensitive contexts. */
  persistCache?: boolean
  /**
   * Use /evaluated-variants-signed and expose {@link Toggly.getVariant} / {@link Toggly.getVariantValue}.
   */
  enableVariants?: boolean
}

export interface TogglyService {
  shouldShowFeatureDuringEvaluation: boolean
  init: (options: TogglyOptions) => this
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
}

export class Toggly implements TogglyService {
  private _config: TogglyOptions = {
    baseURI: 'https://definitions.toggly.io',
    verifySignatures: false,
    showFeatureDuringEvaluation: false,
    enableLiveUpdates: true,
    hooks: []
  }
  private _features: { [key: string]: boolean } | null = null
  private _variants: { [key: string]: EvaluatedVariantDef } | null = null
  private _loadingFeatures: boolean = false
  private _hookExecutor = new HookExecutor()
  private _featuresRefreshListeners = new Set<() => void>()

  _ws: WebSocket | null = null
  _wsConnected: boolean = false
  _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
  _lastFallbackRefresh: number = 0

  static readonly FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000
  static readonly WS_RECONNECT_DELAY = 5000

  shouldShowFeatureDuringEvaluation: boolean = false

  init = (options: TogglyOptions) => {
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

    this._config = Object.assign({}, this._config, options)

    this.shouldShowFeatureDuringEvaluation = this._config.showFeatureDuringEvaluation!
    
    // Register initial hooks
    if (this._config.hooks) {
      this._config.hooks.forEach(hook => this._hookExecutor.addHook(hook))
    }

    // Seed in-memory features (and variants) from localStorage for instant availability
    if (this._features === null && this._canPersist && this._config.appKey) {
      const appKey = this._config.appKey
      const env = this._config.environment ?? 'Production'
      if (this._config.enableVariants) {
        const vCached = readCachedVariants(appKey, env)
        if (vCached) {
          this._variants = vCached
          this._features = variantDefsToFlags(vCached)
        }
      }
      if (this._features === null) {
        const cached = readCachedFlags(appKey, env)
        if (cached) {
          this._features = cached
        }
      }
    }

    return this
  }

  private get _canPersist(): boolean {
    return this._config.persistCache !== false && canUseStorage
  }

  _loadFeatures = async () => {
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

    // Features already loaded — throttle polling when WebSocket is connected
    if (this._features !== null) {
      if (this._wsConnected && (Date.now() - this._lastFallbackRefresh) < Toggly.FALLBACK_REFRESH_INTERVAL) {
        return this._features
      }
      return this._features
    }

    this._loadingFeatures = true

    const isFirstLoad = this._ws === null && this._wsReconnectTimer === null
    const appKey = this._config.appKey ?? ''
    const env = this._config.environment ?? 'Production'

    try {
      let url: string
      if (this._config.enableVariants) {
        url = `${this._config.baseURI}/evaluated-variants-signed/${this._config.appKey}/${this._config.environment}`
        if (this._config.identity) {
          url += `?${new URLSearchParams({ userId: this._config.identity }).toString()}`
        }
      } else {
        url = `${this._config.baseURI}/evaluated-signed/${this._config.appKey}/${this._config.environment}`
        if (this._config.identity) {
          url += `?u=${this._config.identity}`
        }
      }

      const response = await fetch(url)
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
          writeCachedVariants(appKey, env, defs)
          writeCachedFlags(appKey, env, this._features)
        }
      } else {
        this._variants = null
        this._features = payload?.defs ?? payload
        if (this._features && this._canPersist) {
          writeCachedFlags(appKey, env, this._features)
        }
      }

      // Trigger afterRefresh hooks
      if (this._features) {
        await this._hookExecutor.executeAfterRefresh(this._features)
      }
      this.notifyFeaturesRefresh()
    } catch (error) {
      if (this._config.enableVariants) {
        const vCached = this._canPersist ? readCachedVariants(appKey, env) : null
        if (vCached) {
          this._variants = vCached
          this._features = variantDefsToFlags(vCached)
        } else {
          this._variants = null
          const cached = this._canPersist ? readCachedFlags(appKey, env) : null
          this._features = cached ?? this._config.featureDefaults ?? {}
        }
      } else {
        this._variants = null
        const cached = this._canPersist ? readCachedFlags(appKey, env) : null
        this._features = cached ?? this._config.featureDefaults ?? {}
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

    // Start WebSocket after first feature load
    if (isFirstLoad) {
      this.startWebSocket()
    }

    return this._features
  }

  _featuresLoaded = async () => {
    return this._features ?? (await this._loadFeatures())
  }

  _evaluateFeatureGate = async (
    gate: string[],
    requirement = 'all',
    negate = false,
  ) => {
    await this._featuresLoaded()

    if (!this._features || Object.keys(this._features).length === 0) {
      return true
    }

    var isEnabled: boolean

    if (requirement === 'any') {
      isEnabled = gate.reduce((isEnabled: any, featureKey: string | number) => {
        return (
          isEnabled ||
          (this._features![featureKey] && this._features![featureKey] === true)
        )
      }, false)
    } else {
      isEnabled = gate.reduce((isEnabled: any, featureKey: string | number) => {
        return (
          isEnabled &&
          this._features![featureKey] &&
          this._features![featureKey] === true
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
    // For gate evaluation, we call hooks with the first key as representative
    // This is a simplified approach - gates evaluate multiple flags together
    if (featureKeys.length > 0) {
      const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKeys[0])
      const result = await this._evaluateFeatureGate(featureKeys, requirement, negate)
      await this._hookExecutor.executeAfterEvaluation(featureKeys[0], dataMap, result)
      return result
    }
    return await this._evaluateFeatureGate(featureKeys, requirement, negate)
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

  startWebSocket() {
    if (!this._config.appKey) {
      return
    }

    if (this._config.enableLiveUpdates === false) {
      return
    }

    this.stopWebSocket()

    const wsUrl = this._config.baseURI!.replace('https://', 'wss://').replace('http://', 'ws://') + `/${this._config.appKey}/ws`

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      this._wsConnected = true
      this._lastFallbackRefresh = Date.now()
    }

    ws.onmessage = (event) => {
      const data = event.data

      if (typeof data === 'string') {
        // Handle plain text messages
        if (data === 'update' || data === 'flags-updated') {
          this._refreshFeatures()
          return
        }

        // Try to parse as JSON
        try {
          const message = JSON.parse(data)
          if (message.type === 'ping') {
            return
          }
          if (message.type === 'flags-updated' || message.type === 'update') {
            this._refreshFeatures()
          }
        } catch (e) {
          // Unrecognized message, ignore
        }
      }
    }

    ws.onclose = () => {
      this._wsConnected = false
      this._ws = null

      this._wsReconnectTimer = setTimeout(() => {
        this.startWebSocket()
      }, Toggly.WS_RECONNECT_DELAY)
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
    this._features = null
    this._loadingFeatures = false
    const flags = await this._loadFeatures()
    if (flags && this._canPersist) {
      writeCachedFlags(this._config.appKey ?? '', this._config.environment ?? 'Production', flags)
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

const toggly = new Toggly()

export default toggly
