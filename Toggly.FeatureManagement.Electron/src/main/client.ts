import {
  createTelemetryReporter,
  type TelemetryReporter,
} from '@ops-ai/toggly-client-telemetry'
import { gzip } from 'node:zlib'
import {
  appendEvaluationContext,
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
  type LocalGate,
} from '@ops-ai/toggly-local-gates'
import WebSocket from 'ws'
import { createHash, randomUUID } from 'node:crypto'
import { DiskFeatureCache, isValidDefinitions } from './cache.js'
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

  async executeBeforeIdentify(identity: string, current: () => boolean): Promise<unknown> {
    let data: unknown = undefined
    for (const hook of this.hooks) {
      if (!current()) break
      if (hook.beforeIdentify) {
        data = (await hook.beforeIdentify(identity)) ?? data
      }
    }
    return data
  }

  async executeAfterIdentify(identity: string, data: unknown, current: () => boolean): Promise<void> {
    for (const hook of this.hooks) {
      if (!current()) break
      if (hook.afterIdentify) {
        await hook.afterIdentify(identity, data as never)
      }
    }
  }

  async executeAfterRefresh(flags: FeatureFlagsSnapshot, current: () => boolean): Promise<void> {
    for (const hook of this.hooks) {
      if (!current()) break
      if (hook.afterRefresh) {
        await hook.afterRefresh({ ...flags })
      }
    }
  }
}

export type FlagsUpdatedListener = (flags: FeatureFlagsSnapshot) => void

const replacementRetirement = new WeakMap<ElectronTogglyClient, () => void>()

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
  private readonly evaluationListeners = new Set<() => void>()
  private lastEvaluationSnapshot = ''
  private readonly closeListeners = new Set<() => void>()
  private readonly listeners = new Set<FlagsUpdatedListener>()

  private features: EvaluatedDefinitions = {}
  private hasLoadedFlags = false
  private identity: string
  private instanceId: string | undefined
  private contextGeneration = 0
  private groups: string[] = []
  private claims: Record<string, string> = {}
  private cachedDefinitionsRevision: string | null = null
  private pendingDefinitionsPin: string | null = null
  private readonly telemetry: TelemetryReporter
  private readonly requests = new Map<
    AbortController,
    ReturnType<typeof setTimeout>
  >()
  private generation = 0
  private disposed = false
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private ws: WebSocket | null = null
  private wsConnected = false
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private wsReconnectAttempt = 0
  private lastFallbackRefresh = 0
  private localGates: LocalGate[] = []
  private initPromise: Promise<FeatureFlagsSnapshot> | null = null

  constructor(config: TogglyElectronConfig) {
    if (!config.userDataPath) {
      throw new Error('userDataPath is required (pass app.getPath("userData"))')
    }

    this.config = {
      ...config,
      baseURI: config.baseURI ?? DEFAULT_BASE_URI,
      environment: config.environment ?? DEFAULT_ENVIRONMENT,
      connectTimeout: config.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT,
      featureFlagsRefreshInterval:
        config.featureFlagsRefreshInterval ?? DEFAULT_REFRESH_INTERVAL,
      verifySignatures: config.verifySignatures ?? false,
      isDebug: config.isDebug ?? false,
      enableLiveUpdates: config.enableLiveUpdates ?? Boolean(config.appKey),
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
    this.instanceId = config.instanceId?.trim() || undefined
    this.groups = config.groups ? [...config.groups] : []
    this.claims = config.claims ? { ...config.claims } : {}
    this.telemetry = createTelemetryReporter({
      identity: this.identity,
      instanceId: this.instanceId,
      appKey: config.appKey,
      environment: this.config.environment,
      enableTelemetry: config.enableTelemetry,
      metricsBaseUrl: config.metricsBaseUrl,
      telemetryFlushIntervalMs: config.telemetryFlushIntervalMs,
      fetch: config.telemetryFetch,
      onDiagnostic: config.onTelemetryDiagnostic,
      _runtime: {
        gzip: (json) =>
          new Promise((resolve, reject) => {
            gzip(json, (error, bytes) =>
              error ? reject(error) : resolve(Uint8Array.from(bytes).buffer),
            )
          }),
      },
    })
    replacementRetirement.set(this, () => this.retire(false))
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

  /** @internal Change notification for committed React consumers, without snapshot evaluation. */
  onEvaluationsChanged(listener: () => void): () => void {
    this.evaluationListeners.add(listener)
    return () => {
      this.evaluationListeners.delete(listener)
    }
  }

  private notifyEvaluationsChanged(): void {
    const generation = this.generation
    if (this.disposed) return
    for (const listener of this.evaluationListeners) {
      if (this.disposed || generation !== this.generation) break
      try {
        listener()
      } catch (error) {
        this.reportError('Evaluation listener error', error)
      }
    }
  }

  private notifyFlagsUpdated(): void {
    const generation = this.generation
    if (this.disposed) return
    const evaluationSnapshot = JSON.stringify(this.features)
    if (evaluationSnapshot !== this.lastEvaluationSnapshot) {
      this.lastEvaluationSnapshot = evaluationSnapshot
      this.notifyEvaluationsChanged()
    }
    const snapshot = this.getBooleanFlags()
    for (const listener of this.listeners) {
      if (this.disposed || generation !== this.generation) break
      try {
        listener({ ...snapshot })
      } catch (error) {
        this.reportError('Flags updated listener error', error)
      }
    }
  }

  private reportError(message: string, error?: unknown): void {
    try { this.config.onError?.(message, error) } catch { /* Diagnostics cannot interrupt owner cleanup. */ }
    if (this.config.isDebug) {
      console.warn(`[Toggly] ${message}`, error)
    }
  }

  private get contextCacheKey(): string {
    if (this.instanceId) return `i:${createHash('sha256').update(this.instanceId).digest('hex')}`
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
    const url = new URL(this.config.baseURI)
    url.pathname = `${url.pathname.replace(/\/$/, '')}/evaluated-signed/${this.config.appKey}/${this.config.environment}`
    url.hash = ''
    url.searchParams.delete('i')
    if (this.instanceId) {
      for (const key of Array.from(url.searchParams.keys())) {
        if (['u', 'userId', 'g'].includes(key) || key.startsWith('claim.')) url.searchParams.delete(key)
      }
      url.searchParams.set('i', this.instanceId)
    } else {
      appendEvaluationContext(url, { identity: this.identity, groups: this.groups, claims: this.claims }, 'evaluated')
    }
    return url.toString()
  }

  private get transportBaseURI(): string {
    const url = new URL(this.config.baseURI)
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  }

  private buildFetchHeaders(skipIfNoneMatch = false): Record<string, string> {
    const revision = skipIfNoneMatch ? null : this.cachedDefinitionsRevision
    return buildDefinitionFetchHeaders(
      revision
        ? { 'If-None-Match': revision, Accept: 'application/json' }
        : { Accept: 'application/json' },
    )
  }

  private applyRevision(response: Response): void {
    const revision = extractDefinitionsRevision(response)
    if (revision) {
      this.cachedDefinitionsRevision = revision.replace(/^"+|"+$/g, '')
    }
  }

  private async persistCache(existingBodyOnly = false): Promise<void> {
    if (!this.config.appKey) {
      return
    }
    const generation = this.generation
    const context = this.contextCacheKey
    const entry = { flags: structuredClone(this.features), revision: this.cachedDefinitionsRevision, updatedAt: Date.now() }
    try {
      if (existingBodyOnly) {
        const stored = await this.cache.read(this.config.appKey, this.config.environment, context)
        if (this.disposed || generation !== this.generation || !stored || JSON.stringify(stored.flags) !== JSON.stringify(entry.flags)) return
      }
      await this.cache.write(
        this.config.appKey,
        this.config.environment,
        context,
        entry,
      )
    } catch (error) {
      this.reportError('Failed to write disk cache', error)
    }
  }

  private async loadDiskCache(): Promise<boolean> {
    if (!this.config.appKey) {
      return false
    }
    const generation = this.generation
    try {
      const entry = await this.cache.read(
        this.config.appKey,
        this.config.environment,
        this.contextCacheKey,
      )
      if (!entry || this.disposed || generation !== this.generation) {
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

  private captureEvaluation() {
    const record = this.telemetry.captureCheck()
    const features = structuredClone(this.features)
    const defaults = { ...this.config.flagDefaults }
    const gates = (this.disposed ? [] : this.localGates).map(gate => ({ ...gate, flagKeys: [...gate.flagKeys] }))
    const index = buildFlagGateIndex(gates)
    return {
      features,
      resolve: (key: string, context?: TogglyEntityContext | null, gate = false) => {
        // Preserve the existing empty-map gate contract while accounting for
        // every effective leaf that its short circuit actually visits.
        if (gate && Object.keys(features).length === 0) {
          record(key, 'disabled')
          return false
        }
        const resolved = resolveEvaluatedDefinition(features[key], context,
          gate && gates.length === 0 ? false : (defaults[key] ?? false))
        const effective = applyLocalGate(resolved, key, gates, index)
        record(key, effective ? 'enabled' : 'disabled')
        return effective
      },
    }
  }

  isFeatureOn(
    key: string,
    entityContext?: EntityContextInput,
    kind?: string,
  ): boolean {
    const evaluation = this.captureEvaluation()
    const ctx = this.disposed ? null : normalizeEntityContext(entityContext, kind)
    const result = evaluation.resolve(key, ctx)
    void this.runEvaluationHooks(key, () => result)
    return result
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
    const evaluation = this.captureEvaluation()
    const selectedKeys = [...keys]
    const ctx = this.disposed ? null : normalizeEntityContext(entityContext, kind)
    const req = requirement === 'any' ? 'any' : 'all'
    if (keys.length === 0) {
      return !negate
    }
    // Missing leaves still take part in an effective evaluation and short circuit.
    const isEnabled = (key: string) => evaluation.resolve(key, ctx, true)
    let gated: boolean
    if (req === 'any') {
      const anyOn = selectedKeys.some(isEnabled)
      gated = negate ? !anyOn : anyOn
    } else {
      const allOn = selectedKeys.every(isEnabled)
      gated = negate ? !allOn : allOn
    }
    void this.runEvaluationHooks(keys[0], () => gated)
    return gated
  }

  private async runEvaluationHooks(
    flagKey: string,
    evaluate: () => boolean,
  ): Promise<void> {
    if (this.disposed) return
    try {
      const data = await this.hookExecutor.executeBeforeEvaluation(flagKey)
      const result = evaluate()
      await this.hookExecutor.executeAfterEvaluation(flagKey, data, result)
    } catch (error) {
      this.reportError('Hook execution error', error)
    }
  }

  recordUsage(key: string, variant = 'enabled'): void {
    this.telemetry.recordUsage(key, variant)
  }
  recordView(key: string, variant = 'enabled'): void {
    this.telemetry.recordView(key, variant)
  }
  incrementCounter(key: string, value = 1): void {
    this.telemetry.incrementCounter(key, value)
  }
  setGauge(key: string, value: number): void {
    this.telemetry.setGauge(key, value)
  }
  flushTelemetry(): Promise<void> {
    return this.telemetry.flush()
  }

  getFlags(): FeatureFlagsSnapshot {
    return this.getBooleanFlags()
  }

  setLocalGates(gates: LocalGate[]): void {
    if (this.disposed) return
    const next = gates.map(gate => ({ ...gate, flagKeys: [...gate.flagKeys] }))
    buildFlagGateIndex(next)
    this.localGates = next
    this.notifyEvaluationsChanged()
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

    const generation = ++this.generation
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.connectTimeout,
    )
    this.requests.set(controller, timeoutId)
    try {
      const pin = this.pendingDefinitionsPin
      this.pendingDefinitionsPin = null
      const url = appendDefinitionsRevisionParam(this.buildEvaluatedUrl(), pin)
      const headers = this.buildFetchHeaders(Boolean(pin))

      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
      if (this.disposed || generation !== this.generation)
        return this.getBooleanFlags()

      if (response.status === 304) {
        if (!this.hasLoadedFlags) throw new Error('Definitions returned 304 without matching cached flags')
        this.applyRevision(response)
        await this.persistCache(true)
        return this.getBooleanFlags()
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }

      const bodyText = await readResponseBody(response)
      const parsed = await parseEvaluatedResponseBody(bodyText, {
        verifySignatures: this.config.verifySignatures,
        baseURI: this.transportBaseURI,
        allowedKeyIds: this.config.allowedKeyIds,
        maxSignatureAgeSeconds: this.config.maxSignatureAgeSeconds ?? undefined,
        headers,
        fetchImpl: (url, init) => this.fetchImpl(url, { ...init, signal: controller.signal }),
        getJwks: this.config.verifySignatures
          ? () =>
              this.jwksCache.get({
                verifySignatures: true,
                baseURI: this.transportBaseURI,
                allowedKeyIds: this.config.allowedKeyIds,
                maxSignatureAgeSeconds:
                  this.config.maxSignatureAgeSeconds ?? undefined,
                headers,
                fetchImpl: (url, init) => this.fetchImpl(url, { ...init, signal: controller.signal }),
              })
          : undefined,
      })

      const defs =
        (this.config.verifySignatures
          ? (parsed as EvaluatedDefinitions)
          : (unwrapDefsPayload(parsed) as EvaluatedDefinitions)) ?? {}

      if (this.disposed || generation !== this.generation)
        return this.getBooleanFlags()
      if (!isValidDefinitions(defs)) throw new Error('Invalid evaluated definitions body')
      this.features = defs
      this.hasLoadedFlags = true
      this.cachedDefinitionsRevision = null
      this.applyRevision(response)
      await this.persistCache()
      const current = () => !this.disposed && generation === this.generation
      if (!current()) return this.getBooleanFlags()
      await this.hookExecutor.executeAfterRefresh(this.getBooleanFlags(), current)
      if (current()) this.notifyFlagsUpdated()
      return this.getBooleanFlags()
    } catch (error) {
      if (this.disposed || generation !== this.generation)
        return this.getBooleanFlags()
      this.reportError('Failed to refresh feature flags', error)
      if (this.disposed || generation !== this.generation) return this.getBooleanFlags()
      if (!this.hasLoadedFlags) {
        const loaded = await this.loadDiskCache()
        if (this.disposed || generation !== this.generation) return this.getBooleanFlags()
        if (!loaded) {
          this.features = this.getFallbackFlags()
          this.hasLoadedFlags = true
        }
      }
      this.notifyFlagsUpdated()
      return this.getBooleanFlags()
    } finally {
      clearTimeout(timeoutId)
      this.requests.delete(controller)
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
    const context = this.contextGeneration
    await this.loadDiskCache()
    const flags = this.disposed || context !== this.contextGeneration
      ? this.getBooleanFlags() : await this.refresh()
    if (this.disposed) return flags
    this.startRefreshInterval()
    if (this.config.enableLiveUpdates && this.config.appKey) {
      this.startWebSocket()
    }
    return flags
  }

  async setContext(input: SetContextInput): Promise<FeatureFlagsSnapshot> {
    if (this.disposed) return this.getBooleanFlags()
    input = { ...input, groups: input.groups && [...input.groups], claims: input.claims && { ...input.claims } }
    const transaction = ++this.contextGeneration
    ++this.generation
    for (const [controller, timer] of this.requests) {
      clearTimeout(timer)
      controller.abort()
    }
    this.requests.clear()
    if (input.identity !== undefined) this.identity = input.identity
    if (input.instanceId !== undefined) this.instanceId = input.instanceId.trim() || undefined
    else if (input.identity !== undefined) this.instanceId = undefined
    if (input.groups !== undefined) this.groups = [...input.groups]
    if (input.claims !== undefined) this.claims = { ...input.claims }
    this.telemetry.setContext({ identity: this.identity, instanceId: this.instanceId ?? '' })
    this.features = { ...this.config.flagDefaults }
    this.hasLoadedFlags = false
    this.cachedDefinitionsRevision = null
    this.pendingDefinitionsPin = null
    this.stopWebSocket()
    if (this.refreshDebounceTimer) clearTimeout(this.refreshDebounceTimer)
    this.refreshDebounceTimer = null
    const current = () => !this.disposed && transaction === this.contextGeneration
    this.notifyFlagsUpdated()
    if (input.identity !== undefined && current()) {
      const data = await this.hookExecutor.executeBeforeIdentify(input.identity, current)
      if (current()) await this.hookExecutor.executeAfterIdentify(input.identity, data, current)
    }
    if (!current()) return this.getBooleanFlags()
    await this.loadDiskCache()
    if (!current()) return this.getBooleanFlags()
    const flags = await this.refresh()
    if (current()) this.startWebSocket()
    return flags
  }

  async clearContext(): Promise<FeatureFlagsSnapshot> {
    return this.setContext({ identity: randomUUID(), instanceId: '', groups: [], claims: {} })
  }

  private startRefreshInterval(): void {
    this.stopRefreshInterval()
    if (!this.config.appKey || this.config.featureFlagsRefreshInterval <= 0) return
    const interval = () =>
      this.wsConnected
        ? FALLBACK_REFRESH_INTERVAL
        : this.config.featureFlagsRefreshInterval

    this.refreshTimer = setInterval(
      () => {
        if (this.wsConnected) {
          const elapsed = Date.now() - this.lastFallbackRefresh
          if (elapsed < FALLBACK_REFRESH_INTERVAL) {
            return
          }
        }
        this.lastFallbackRefresh = Date.now()
        void this.refresh()
      },
      Math.min(interval(), this.config.featureFlagsRefreshInterval),
    )
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
      const plan = planFlagsUpdatedRefresh(
        message,
        this.cachedDefinitionsRevision,
      )
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
    if (
      this.disposed ||
      !this.config.appKey ||
      !this.config.enableLiveUpdates
    ) {
      return
    }
    this.stopWebSocket(false)

    const url = buildWebSocketUrl(
      this.transportBaseURI,
      this.config.appKey,
      this.cachedDefinitionsRevision,
    )

    try {
      const ws = new WebSocket(url)
      this.ws = ws
      const current = () => !this.disposed && this.ws === ws

      ws.on('open', () => {
        if (!current()) return
        this.wsConnected = true
        this.wsReconnectAttempt = 0
        this.lastFallbackRefresh = Date.now()
        if (this.config.isDebug) {
          console.log('[Toggly] WebSocket connected')
        }
      })

      ws.on('message', (data) => { if (current()) this.handleWsMessage(data) })

      ws.on('close', () => {
        if (!current()) return
        this.wsConnected = false
        this.ws = null
        this.scheduleReconnect()
      })

      ws.on('error', (error) => {
        if (!current()) return
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

  /** @internal Allows main-process adapters to detach from this exact owner. */
  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  close(): void {
    this.retire(true)
  }

  /** @internal Owner replacement discards unflushed telemetry. */
  private retire(flush = false): void {
    if (this.disposed) return
    this.disposed = true
    this.generation++
    for (const [controller, timer] of this.requests) {
      clearTimeout(timer)
      controller.abort()
    }
    this.requests.clear()
    try { this.telemetry.dispose({ flush }) } catch (error) { this.reportError('Telemetry cleanup error', error) }
    for (const listener of this.closeListeners) {
      try { listener() } catch (error) { this.reportError('Close listener error', error) }
    }
    this.closeListeners.clear()
    this.stopRefreshInterval()
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer)
      this.refreshDebounceTimer = null
    }
    this.stopWebSocket(true)
    this.listeners.clear()
    this.evaluationListeners.clear()
    this.initPromise = null
  }
}

let singleton: ElectronTogglyClient | null = null
let singletonGeneration = 0
let closingSingleton = false

export async function initToggly(
  config: TogglyElectronConfig,
): Promise<FeatureFlagsSnapshot> {
  if (closingSingleton) return {}
  const generation = ++singletonGeneration
  const previous = singleton
  singleton = null
  if (previous) replacementRetirement.get(previous)?.()
  if (generation !== singletonGeneration) return getToggly()?.init() ?? {}
  const candidate = new ElectronTogglyClient(config)
  if (generation !== singletonGeneration) {
    replacementRetirement.get(candidate)?.()
    return getToggly()?.init() ?? {}
  }
  singleton = candidate
  return candidate.init()
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
  ++singletonGeneration
  const previous = singleton
  singleton = null
  closingSingleton = true
  try { previous?.close() } finally { closingSingleton = false }
}

/** Test helper — reset singleton without requiring prior init. */
export function __resetTogglyForTests(): void {
  closeToggly()
}

export function recordUsage(key: string, variant = 'enabled'): void {
  singleton?.recordUsage(key, variant)
}
export function recordView(key: string, variant = 'enabled'): void {
  singleton?.recordView(key, variant)
}
export function incrementCounter(key: string, value = 1): void {
  singleton?.incrementCounter(key, value)
}
export function setGauge(key: string, value: number): void {
  singleton?.setGauge(key, value)
}
export function flushTelemetry(): Promise<void> {
  return singleton?.flushTelemetry() ?? Promise.resolve()
}
