import {
  appendEvaluationContext,
  evaluateEvaluatedGate,
  normalizeEntityContext,
  resolveEvaluatedDefinition,
  toBooleanDefinitions,
  type EvaluatedDefinitions,
  type Hook,
  type TogglyEntityContext,
  type EvaluationSeriesData,
} from '@ops-ai/toggly-hooks-types'
import {
  InMemoryJwksCache,
  parseEvaluatedResponseBody,
  readResponseBody,
  unwrapDefsPayload,
} from '@ops-ai/toggly-signed-defs'
import {
  applyLocalGate,
  buildFlagGateIndex,
  type FlagGateIndex,
  type LocalGate,
} from '@ops-ai/toggly-local-gates'
import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import { DiskFeatureCache } from './cache.js'
import { buildDefinitionFetchHeaders } from '../sdk-identity.js'
import {
  appendDefinitionsRevisionParam,
  applyFlagsUpdatedPlan,
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  planFlagsUpdatedRefresh,
  REFRESH_DEBOUNCE_MS,
  shouldFetchOnSync,
  type WsSyncMessage,
} from '../ws-sync.js'
import type {
  EntityContextInput,
  FeatureFlagsSnapshot,
  FeatureRequirement,
  SetContextInput,
  TogglyElectronConfig,
} from '../types.js'

const DEFAULT_BASE_URI = 'https://definitions.toggly.io'
const DEFAULT_ENVIRONMENT = 'Production'
const DEFAULT_CONNECT_TIMEOUT = 5000
const DEFAULT_REFRESH_INTERVAL = 3 * 60 * 1000
const FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000

class HookExecutor {
  private hooks: Hook[] = []

  addHook(hook: Hook): void {
    this.hooks.push(hook)
  }

  async executeBeforeEvaluation(
    flagKey: string,
    defaultValue?: boolean,
  ): Promise<EvaluationSeriesData | void> {
    let data: EvaluationSeriesData | void = undefined
    for (const hook of this.hooks) {
      if (hook.beforeEvaluation) {
        data = (await hook.beforeEvaluation(flagKey, defaultValue)) ?? data
      }
    }
    return data
  }

  async executeAfterEvaluation(
    flagKey: string,
    data: EvaluationSeriesData | void,
    result: boolean,
  ): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.afterEvaluation) {
        await hook.afterEvaluation(flagKey, data, result)
      }
    }
  }

  async executeBeforeIdentify(identity: string): Promise<unknown> {
    let data: unknown = undefined
    for (const hook of this.hooks) {
      if (hook.beforeIdentify) {
        data = (await hook.beforeIdentify(identity)) ?? data
      }
    }
    return data
  }

  async executeAfterIdentify(identity: string, data: unknown): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.afterIdentify) {
        await hook.afterIdentify(identity, data as never)
      }
    }
  }

  async executeAfterRefresh(flags: FeatureFlagsSnapshot): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.afterRefresh) {
        await hook.afterRefresh(flags)
      }
    }
  }
}

export type FlagsUpdatedListener = (flags: FeatureFlagsSnapshot) => void

export class ElectronTogglyClient {
  private config: Required<
    Pick<
      TogglyElectronConfig,
      | 'baseURI'
      | 'environment'
      | 'connectTimeout'
      | 'featureFlagsRefreshInterval'
      | 'verifySignatures'
      | 'isDebug'
      | 'userDataPath'
    >
  > &
    TogglyElectronConfig

  private readonly cache: DiskFeatureCache
  private readonly hookExecutor = new HookExecutor()
  private readonly jwksCache = new InMemoryJwksCache()
  private readonly fetchImpl: typeof fetch
  private readonly listeners = new Set<FlagsUpdatedListener>()

  private features: EvaluatedDefinitions = {}
  private hasLoadedFlags = false
  private identity: string
  private groups: string[] = []
  private claims: Record<string, string> = {}
  private cachedDefinitionsRevision: string | null = null
  private pendingDefinitionsPin: string | null = null
  private disposed = false
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private ws: WebSocket | null = null
  private wsConnected = false
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private wsReconnectAttempt = 0
  private lastFallbackRefresh = 0
  private localGates: LocalGate[] = []
  private localGateIndex: FlagGateIndex = new Map()
  private initPromise: Promise<FeatureFlagsSnapshot> | null = null

  constructor(config: TogglyElectronConfig) {
    if (!config.userDataPath) {
      throw new Error('userDataPath is required (pass app.getPath("userData"))')
    }

    this.config = {
      baseURI: config.baseURI ?? DEFAULT_BASE_URI,
      environment: config.environment ?? DEFAULT_ENVIRONMENT,
      connectTimeout: config.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT,
      featureFlagsRefreshInterval:
        config.featureFlagsRefreshInterval ?? DEFAULT_REFRESH_INTERVAL,
      verifySignatures: config.verifySignatures ?? false,
      isDebug: config.isDebug ?? false,
      enableLiveUpdates:
        config.enableLiveUpdates ?? Boolean(config.appKey),
      ...config,
      userDataPath: config.userDataPath,
    }

    this.cache = new DiskFeatureCache(this.config.userDataPath)
    this.fetchImpl =
      config.fetch ??
      (typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : (() => {
            throw new Error('fetch is not available; provide config.fetch')
          })())

    this.identity = config.identity ?? randomUUID()
    this.groups = config.groups ? [...config.groups] : []
    this.claims = config.claims ? { ...config.claims } : {}

    if (config.hooks) {
      for (const hook of config.hooks) {
        this.hookExecutor.addHook(hook)
      }
    }
  }

  addHook(hook: Hook): void {
    this.hookExecutor.addHook(hook)
  }

  onFlagsUpdated(listener: FlagsUpdatedListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyFlagsUpdated(): void {
    const snapshot = this.getBooleanFlags()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch (error) {
        this.reportError('Flags updated listener error', error)
      }
    }
  }

  private reportError(message: string, error?: unknown): void {
    this.config.onError?.(message, error)
    if (this.config.isDebug) {
      console.warn(`[Toggly] ${message}`, error)
    }
  }

  private get contextCacheKey(): string {
    const claims = this.claims
    return `v2:${encodeURIComponent(
      JSON.stringify([
        this.identity ?? '',
        [...this.groups].sort((a, b) => a.localeCompare(b)),
        Object.entries(claims).sort(([a], [b]) => a.localeCompare(b)),
      ]),
    )}`
  }

  private getBooleanFlags(): FeatureFlagsSnapshot {
    return toBooleanDefinitions(this.features)
  }

  private getFallbackFlags(): EvaluatedDefinitions {
    if (this.hasLoadedFlags) {
      return this.features
    }
    const defaults = this.config.flagDefaults ?? {}
    return { ...defaults }
  }

  private buildEvaluatedUrl(): string {
    const base = this.config.baseURI.replace(/\/$/, '')
    const url = new URL(
      `${base}/evaluated-signed/${this.config.appKey}/${this.config.environment}`,
    )
    appendEvaluationContext(
      url,
      {
        identity: this.identity,
        groups: this.groups,
        claims: this.claims,
      },
      'evaluated',
    )
    return url.toString()
  }

  private buildFetchHeaders(skipIfNoneMatch = false): Record<string, string> {
    const revision = skipIfNoneMatch ? null : this.cachedDefinitionsRevision
    return buildDefinitionFetchHeaders(
      revision ? { 'If-None-Match': revision, Accept: 'application/json' } : { Accept: 'application/json' },
    )
  }

  private applyRevision(response: Response): void {
    const revision = extractDefinitionsRevision(response)
    if (revision) {
      this.cachedDefinitionsRevision = revision.replace(/^"+|"+$/g, '')
    }
  }

  private async persistCache(): Promise<void> {
    if (!this.config.appKey) {
      return
    }
    try {
      await this.cache.write(
        this.config.appKey,
        this.config.environment,
        this.contextCacheKey,
        {
          flags: this.features,
          revision: this.cachedDefinitionsRevision,
          updatedAt: Date.now(),
        },
      )
    } catch (error) {
      this.reportError('Failed to write disk cache', error)
    }
  }

  private async loadDiskCache(): Promise<boolean> {
    if (!this.config.appKey) {
      return false
    }
    try {
      const entry = await this.cache.read(
        this.config.appKey,
        this.config.environment,
        this.contextCacheKey,
      )
      if (!entry) {
        return false
      }
      this.features = entry.flags
      this.cachedDefinitionsRevision = entry.revision
      this.hasLoadedFlags = true
      return true
    } catch (error) {
      this.reportError('Failed to read disk cache', error)
      return false
    }
  }

  private resolveEffectiveFlag(
    key: string,
    entityContext?: TogglyEntityContext | null,
  ): boolean {
    const resolved = resolveEvaluatedDefinition(
      this.features[key],
      entityContext,
      this.config.flagDefaults?.[key] ?? false,
    )
    return applyLocalGate(resolved, key, this.localGates, this.localGateIndex)
  }

  isFeatureOn(
    key: string,
    entityContext?: EntityContextInput,
    kind?: string,
  ): boolean {
    const ctx = normalizeEntityContext(entityContext, kind)
    void this.runEvaluationHooks(key, () => this.resolveEffectiveFlag(key, ctx))
    return this.resolveEffectiveFlag(key, ctx)
  }

  isFeatureOff(
    key: string,
    entityContext?: EntityContextInput,
    kind?: string,
  ): boolean {
    return !this.isFeatureOn(key, entityContext, kind)
  }

  evaluateFeatureGate(
    keys: string[],
    requirement: FeatureRequirement | string = 'all',
    negate = false,
    entityContext?: EntityContextInput,
    kind?: string,
  ): boolean {
    const ctx = normalizeEntityContext(entityContext, kind)
    const req = requirement === 'any' ? 'any' : 'all'
    if (keys.length === 0) {
      return !negate
    }
    // Empty feature map with keys → fail closed (match evaluateStoredFeatureKeys)
    if (Object.keys(this.features).length === 0) {
      const closed = negate
      void this.runEvaluationHooks(keys[0], () => closed)
      return closed
    }
    const isEnabled = (key: string) => this.resolveEffectiveFlag(key, ctx)
    let gated: boolean
    if (req === 'any') {
      const anyOn = keys.some(isEnabled)
      gated = negate ? !anyOn : anyOn
    } else {
      const allOn = keys.every(isEnabled)
      gated = negate ? !allOn : allOn
    }
    // Keep evaluateEvaluatedGate in the hot path for parity when no local gates
    if (this.localGates.length === 0) {
      gated = evaluateEvaluatedGate(this.features, keys, req, negate, ctx)
    }
    void this.runEvaluationHooks(keys[0], () => gated)
    return gated
  }

  private async runEvaluationHooks(
    flagKey: string,
    evaluate: () => boolean,
  ): Promise<void> {
    try {
      const data = await this.hookExecutor.executeBeforeEvaluation(flagKey)
      const result = evaluate()
      await this.hookExecutor.executeAfterEvaluation(flagKey, data, result)
    } catch (error) {
      this.reportError('Hook execution error', error)
    }
  }

  getFlags(): FeatureFlagsSnapshot {
    return this.getBooleanFlags()
  }

  setLocalGates(gates: LocalGate[]): void {
    this.localGates = [...gates]
    this.localGateIndex = buildFlagGateIndex(this.localGates)
  }

  async refresh(): Promise<FeatureFlagsSnapshot> {
    if (this.disposed) {
      return this.getBooleanFlags()
    }

    if (!this.config.appKey) {
      this.features = { ...(this.config.flagDefaults ?? {}) }
      this.hasLoadedFlags = true
      this.notifyFlagsUpdated()
      return this.getBooleanFlags()
    }

    try {
      const pin = this.pendingDefinitionsPin
      this.pendingDefinitionsPin = null
      const url = appendDefinitionsRevisionParam(this.buildEvaluatedUrl(), pin)
      const headers = this.buildFetchHeaders(Boolean(pin))

      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.connectTimeout,
      )

      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (response.status === 304) {
        this.applyRevision(response)
        await this.persistCache()
        return this.getBooleanFlags()
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }

      const bodyText = await readResponseBody(response)
      const parsed = await parseEvaluatedResponseBody(bodyText, {
        verifySignatures: this.config.verifySignatures,
        baseURI: this.config.baseURI,
        allowedKeyIds: this.config.allowedKeyIds,
        maxSignatureAgeSeconds: this.config.maxSignatureAgeSeconds ?? undefined,
        headers,
        fetchImpl: this.fetchImpl,
        getJwks: this.config.verifySignatures
          ? () =>
              this.jwksCache.get({
                verifySignatures: true,
                baseURI: this.config.baseURI,
                allowedKeyIds: this.config.allowedKeyIds,
                maxSignatureAgeSeconds:
                  this.config.maxSignatureAgeSeconds ?? undefined,
                headers,
                fetchImpl: this.fetchImpl,
              })
          : undefined,
      })

      const defs = (
        this.config.verifySignatures
          ? (parsed as EvaluatedDefinitions)
          : (unwrapDefsPayload(parsed) as EvaluatedDefinitions)
      ) ?? {}

      this.features = defs
      this.hasLoadedFlags = true
      this.applyRevision(response)
      await this.persistCache()
      await this.hookExecutor.executeAfterRefresh(this.getBooleanFlags())
      this.notifyFlagsUpdated()
      return this.getBooleanFlags()
    } catch (error) {
      this.reportError('Failed to refresh feature flags', error)
      if (!this.hasLoadedFlags) {
        const loaded = await this.loadDiskCache()
        if (!loaded) {
          this.features = this.getFallbackFlags()
          this.hasLoadedFlags = true
        }
      }
      this.notifyFlagsUpdated()
      return this.getBooleanFlags()
    }
  }

  async init(): Promise<FeatureFlagsSnapshot> {
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.doInit()
    return this.initPromise
  }

  private async doInit(): Promise<FeatureFlagsSnapshot> {
    await this.loadDiskCache()
    const flags = await this.refresh()
    this.startRefreshInterval()
    if (this.config.enableLiveUpdates && this.config.appKey) {
      this.startWebSocket()
    }
    return flags
  }

  async setContext(input: SetContextInput): Promise<FeatureFlagsSnapshot> {
    if (input.identity !== undefined) {
      const data = await this.hookExecutor.executeBeforeIdentify(input.identity)
      this.identity = input.identity
      await this.hookExecutor.executeAfterIdentify(input.identity, data)
    }
    if (input.groups !== undefined) {
      this.groups = [...input.groups]
    }
    if (input.claims !== undefined) {
      this.claims = { ...input.claims }
    }
    this.hasLoadedFlags = false
    this.cachedDefinitionsRevision = null
    return this.refresh()
  }

  async clearContext(): Promise<FeatureFlagsSnapshot> {
    this.identity = randomUUID()
    this.groups = []
    this.claims = {}
    this.hasLoadedFlags = false
    this.cachedDefinitionsRevision = null
    return this.refresh()
  }

  private startRefreshInterval(): void {
    this.stopRefreshInterval()
    const interval = () =>
      this.wsConnected
        ? FALLBACK_REFRESH_INTERVAL
        : this.config.featureFlagsRefreshInterval

    this.refreshTimer = setInterval(() => {
      if (this.wsConnected) {
        const elapsed = Date.now() - this.lastFallbackRefresh
        if (elapsed < FALLBACK_REFRESH_INTERVAL) {
          return
        }
      }
      this.lastFallbackRefresh = Date.now()
      void this.refresh()
    }, Math.min(interval(), this.config.featureFlagsRefreshInterval))
  }

  private stopRefreshInterval(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private scheduleDebouncedRefresh(forceJwksRefresh = false): void {
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer)
    }
    this.refreshDebounceTimer = setTimeout(() => {
      this.refreshDebounceTimer = null
      if (forceJwksRefresh && this.config.verifySignatures) {
        this.cachedDefinitionsRevision = null
        this.jwksCache.clear()
      }
      void this.refresh()
    }, REFRESH_DEBOUNCE_MS)
  }

  private handleWsMessage(raw: WebSocket.RawData): void {
    try {
      const message = JSON.parse(String(raw)) as WsSyncMessage
      if (message.type === 'ping') {
        return
      }
      if (shouldFetchOnSync(message, this.cachedDefinitionsRevision)) {
        this.scheduleDebouncedRefresh()
        return
      }
      if (message.type === 'sync' && message.etag) {
        this.cachedDefinitionsRevision = message.etag
        return
      }
      const plan = planFlagsUpdatedRefresh(message, this.cachedDefinitionsRevision)
      applyFlagsUpdatedPlan(plan, message, {
        refreshJwks: () => this.scheduleDebouncedRefresh(true),
        refreshPinned: (pin) => {
          this.pendingDefinitionsPin = pin
          this.cachedDefinitionsRevision = null
          this.scheduleDebouncedRefresh()
        },
        cacheEtagIfPresent: (etag) => {
          this.cachedDefinitionsRevision = etag
        },
      })
    } catch (error) {
      this.reportError('Failed to parse WebSocket message', error)
    }
  }

  startWebSocket(): void {
    if (this.disposed || !this.config.appKey || !this.config.enableLiveUpdates) {
      return
    }
    this.stopWebSocket(false)

    const url = buildWebSocketUrl(
      this.config.baseURI,
      this.config.appKey,
      this.cachedDefinitionsRevision,
    )

    try {
      const ws = new WebSocket(url)
      this.ws = ws

      ws.on('open', () => {
        this.wsConnected = true
        this.wsReconnectAttempt = 0
        this.lastFallbackRefresh = Date.now()
        if (this.config.isDebug) {
          console.log('[Toggly] WebSocket connected')
        }
      })

      ws.on('message', (data) => this.handleWsMessage(data))

      ws.on('close', () => {
        this.wsConnected = false
        this.ws = null
        this.scheduleReconnect()
      })

      ws.on('error', (error) => {
        this.reportError('WebSocket error', error)
      })
    } catch (error) {
      this.reportError('Failed to start WebSocket', error)
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.config.enableLiveUpdates) {
      return
    }
    if (this.wsReconnectTimer) {
      return
    }
    const delay = getNextReconnectDelayMs(this.wsReconnectAttempt)
    this.wsReconnectAttempt += 1
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null
      this.startWebSocket()
    }, delay)
  }

  stopWebSocket(clearReconnect = true): void {
    if (this.wsReconnectTimer && clearReconnect) {
      clearTimeout(this.wsReconnectTimer)
      this.wsReconnectTimer = null
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        this.ws.close()
      } catch {
        // ignore
      }
      this.ws = null
    }
    this.wsConnected = false
  }

  close(): void {
    this.disposed = true
    this.stopRefreshInterval()
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer)
      this.refreshDebounceTimer = null
    }
    this.stopWebSocket(true)
    this.listeners.clear()
    this.initPromise = null
  }
}

let singleton: ElectronTogglyClient | null = null

export async function initToggly(
  config: TogglyElectronConfig,
): Promise<FeatureFlagsSnapshot> {
  if (singleton) {
    singleton.close()
  }
  singleton = new ElectronTogglyClient(config)
  return singleton.init()
}

export function getToggly(): ElectronTogglyClient | null {
  return singleton
}

export function isFeatureOn(
  key: string,
  entityContext?: EntityContextInput,
  kind?: string,
): boolean {
  return singleton?.isFeatureOn(key, entityContext, kind) ?? false
}

export function isFeatureOff(
  key: string,
  entityContext?: EntityContextInput,
  kind?: string,
): boolean {
  return singleton?.isFeatureOff(key, entityContext, kind) ?? true
}

export function evaluateFeatureGate(
  keys: string[],
  requirement?: FeatureRequirement | string,
  negate?: boolean,
  entityContext?: EntityContextInput,
  kind?: string,
): boolean {
  if (!singleton) {
    return negate ?? false
  }
  return singleton.evaluateFeatureGate(
    keys,
    requirement,
    negate,
    entityContext,
    kind,
  )
}

export async function setContext(
  input: SetContextInput,
): Promise<FeatureFlagsSnapshot> {
  if (!singleton) {
    throw new Error('Toggly is not initialized. Call initToggly first.')
  }
  return singleton.setContext(input)
}

export async function clearContext(): Promise<FeatureFlagsSnapshot> {
  if (!singleton) {
    throw new Error('Toggly is not initialized. Call initToggly first.')
  }
  return singleton.clearContext()
}

export function addHook(hook: Hook): void {
  singleton?.addHook(hook)
}

export function closeToggly(): void {
  singleton?.close()
  singleton = null
}

/** Test helper — reset singleton without requiring prior init. */
export function __resetTogglyForTests(): void {
  singleton?.close()
  singleton = null
}
