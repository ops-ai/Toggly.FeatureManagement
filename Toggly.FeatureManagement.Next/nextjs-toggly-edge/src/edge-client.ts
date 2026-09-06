import {
  evaluateDefinitions,
  evaluateLocalFeatureGate,
  generateUUID,
  normalizeFeatureKeys,
  normalizeEntityContext,
  parseDefinitionsPayload,
  snapshotEvaluatedBooleans,
  DEFAULT_CONFIG,
  API_ENDPOINTS,
  fromHttpRequest,
  resolveTelemetryEnableFlag,
  TelemetryRuntime,
  type EvalContextArg,
  type EvalContextOverrides,
  type FeatureDefinitions,
  type FeatureRequirement,
  type FeatureDefinitionModel,
  type TogglyEntityContext,
} from '@ops-ai/nextjs-toggly-core'
import type { TogglyEdgeConfig, EdgeClientState } from './types'
import { parseEvaluatedResponseBody, readResponseBody } from './signed-response'

/**
 * Default edge configuration
 */
const DEFAULT_EDGE_CONFIG: Partial<TogglyEdgeConfig> = {
  cache: true,
  cacheTtl: 60, // 60 seconds
}

type EntityContextArg =
  | TogglyEntityContext
  | Record<string, unknown>
  | null
  | undefined

function resolveEdgeTelemetryFlags(config: TogglyEdgeConfig): {
  enableUsageTracking: boolean
  enableMetrics: boolean
} {
  const hasAppKey = Boolean(config.appKey)
  // TOGGLY_DISABLE_TELEMETRY=1 is authoritative over explicit true.
  return {
    enableUsageTracking: resolveTelemetryEnableFlag(
      config.enableUsageTracking,
      hasAppKey,
    ),
    enableMetrics: resolveTelemetryEnableFlag(config.enableMetrics, hasAppKey),
  }
}

/**
 * Edge-compatible Toggly client.
 * Fetches identity-agnostic definitions-signed payloads and evaluates per call
 * with overrides (never mutates shared identity for targeting).
 * Telemetry uses HTTPS JSON (`api/usage/stats`, `api/metrics`) — no Node gRPC.
 */
export class TogglyEdgeClient {
  private config: TogglyEdgeConfig
  private definitions: Map<string, FeatureDefinitionModel> = new Map()
  private state: EdgeClientState = {
    initialized: false,
    features: {},
    lastFetch: null,
    error: null,
  }
  private telemetry: TelemetryRuntime | null = null

  constructor(config: TogglyEdgeConfig) {
    this.config = {
      baseUri: DEFAULT_CONFIG.baseUri,
      environment: DEFAULT_CONFIG.environment,
      ...DEFAULT_EDGE_CONFIG,
      ...config,
      featureDefaults: config.featureDefaults ?? {},
    }

    this.state.features = { ...this.config.featureDefaults }

    if (!this.config.identity) {
      this.config.identity = generateUUID()
    }

    this.startTelemetry()
  }

  private startTelemetry(): void {
    const flags = resolveEdgeTelemetryFlags(this.config)
    if (!this.config.appKey || (!flags.enableUsageTracking && !flags.enableMetrics)) {
      return
    }
    this.telemetry = new TelemetryRuntime({
      appKey: this.config.appKey,
      environment: this.config.environment ?? DEFAULT_CONFIG.environment,
      metricsBaseUrl: this.config.metricsBaseUrl,
      enableUsageTracking: flags.enableUsageTracking,
      enableMetrics: flags.enableMetrics,
      usageFlushInterval: this.config.usageFlushInterval ?? 0,
      metricsFlushInterval: this.config.metricsFlushInterval ?? 0,
      instanceName: this.config.instanceName ?? 'nextjs-edge',
      appVersion: this.config.appVersion,
      transport: 'https',
      attachProcessHandlers: false,
      restoreOnSendFailure: true,
      fetchImpl: this.config.telemetryFetch,
      usageClient: this.config.usageClient,
      metricsClient: this.config.metricsClient,
    })
    this.telemetry.start()
  }

  getState(): EdgeClientState {
    return { ...this.state }
  }

  /**
   * Default identity used when callers omit per-call overrides.
   * Prefer passing overrides into isFeatureOn / evaluateFeatureGate instead of
   * mutating this setter from concurrent middleware.
   */
  get identity(): string | undefined {
    return this.config.identity
  }

  set identity(value: string | undefined) {
    this.config.identity = value
  }

  private resolveEntity(
    context?: EntityContextArg,
    kind?: string,
  ): TogglyEntityContext | null | undefined {
    if (context === undefined && kind === undefined) {
      return undefined
    }
    return normalizeEntityContext(context, kind)
  }

  private buildEvalContext(
    overrides?: EvalContextArg,
    entityContext?: EntityContextArg,
    kind?: string,
  ) {
    const o: EvalContextOverrides =
      typeof overrides === 'string' ? { identity: overrides } : overrides ?? {}
    return {
      identity: o.identity ?? this.config.identity,
      groups: o.groups ?? this.config.groups,
      traits: o.claims ?? this.config.claims,
      claims: o.claims ?? this.config.claims,
      request: o.request,
      entity: this.resolveEntity(entityContext, kind) ?? undefined,
    }
  }

  private refreshDefaultSnapshot(): FeatureDefinitions {
    const snapshot = snapshotEvaluatedBooleans(
      this.definitions,
      this.buildEvalContext(),
    )
    this.state.features = {
      ...this.config.featureDefaults,
      ...snapshot,
    }
    return this.state.features
  }

  private evaluateFlag(
    featureKey: string,
    overrides?: EvalContextArg,
    entityContext?: EntityContextArg,
    kind?: string,
  ): boolean {
    if (this.definitions.has(featureKey)) {
      return evaluateDefinitions(
        this.definitions,
        featureKey,
        this.buildEvalContext(overrides, entityContext, kind),
      )
    }
    return this.config.featureDefaults?.[featureKey] ?? false
  }

  private evaluateAndRecordCheck(
    featureKey: string,
    overrides?: EvalContextArg,
    entityContext?: EntityContextArg,
    kind?: string,
  ): boolean {
    const result = this.evaluateFlag(featureKey, overrides, entityContext, kind)
    if (this.telemetry?.usageEnabled) {
      const ctx = this.buildEvalContext(overrides, entityContext, kind)
      this.telemetry.recordCheck(featureKey, result, ctx.identity, undefined, true)
    }
    return result
  }

  private evaluateGateKeys(
    featureKeys: string[],
    requirement: FeatureRequirement,
    negate: boolean,
    overrides?: EvalContextArg,
    entityContext?: EntityContextArg,
    kind?: string,
  ): boolean {
    if (this.definitions.size === 0) {
      const fallback = evaluateGateFallback(
        this.state.features,
        featureKeys,
        requirement,
        negate,
      )
      if (this.telemetry?.usageEnabled) {
        for (const key of featureKeys) {
          const enabled = this.state.features[key] === true
          const ctx = this.buildEvalContext(overrides, entityContext, kind)
          this.telemetry.recordCheck(key, enabled, ctx.identity, undefined, true)
        }
      }
      return fallback
    }

    // Record once per key (eval for telemetry), then gate against definitions.
    if (this.telemetry?.usageEnabled) {
      for (const key of featureKeys) {
        const enabled = this.evaluateFlag(key, overrides, entityContext, kind)
        const ctx = this.buildEvalContext(overrides, entityContext, kind)
        this.telemetry.recordCheck(key, enabled, ctx.identity, undefined, true)
      }
    }
    return evaluateLocalFeatureGate(
      this.definitions,
      featureKeys,
      requirement,
      negate,
      this.buildEvalContext(overrides, entityContext, kind),
    )
  }

  private cacheValid(): boolean {
    if (
      !this.config.cache ||
      !this.state.lastFetch ||
      !this.state.initialized
    ) {
      return false
    }
    const elapsed = Date.now() - this.state.lastFetch
    const ttlMs = (this.config.cacheTtl ?? 60) * 1000
    return elapsed < ttlMs
  }

  /**
   * Fetch definitions-signed rules (identity-agnostic) and cache them.
   */
  async fetchDefinitions(): Promise<FeatureDefinitions> {
    if (!this.config.appKey) {
      console.warn('[Toggly Edge] No appKey provided, using defaults only')
      return { ...this.config.featureDefaults }
    }

    if (this.cacheValid()) {
      return this.state.features
    }

    const url = API_ENDPOINTS.definitionsSigned(
      this.config.baseUri ?? DEFAULT_CONFIG.baseUri,
      this.config.appKey,
      this.config.environment ?? DEFAULT_CONFIG.environment,
    )

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        // Use cf cache for Cloudflare Workers
        // @ts-expect-error - cf property exists in Cloudflare Workers
        cf: this.config.cache
          ? {
              cacheTtl: this.config.cacheTtl ?? 60,
              cacheEverything: true,
            }
          : undefined,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const bodyText = await readResponseBody(response)
      const parsed = await parseEvaluatedResponseBody(bodyText, {
        verifySignatures: this.config.verifySignatures,
        baseUri: this.config.baseUri ?? DEFAULT_CONFIG.baseUri,
        allowedKeyIds: this.config.allowedKeyIds,
        maxSignatureAgeSeconds: this.config.maxSignatureAgeSeconds,
        headers,
      })

      this.definitions = parseDefinitionsPayload(parsed)
      this.state.lastFetch = Date.now()
      this.state.initialized = true
      this.state.error = null
      return this.refreshDefaultSnapshot()
    } catch (error) {
      console.error('[Toggly Edge] Failed to fetch feature definitions:', error)
      this.state.error = error as Error
      this.config.onError?.('Error fetching feature flags', error)

      if (!this.state.initialized || this.definitions.size === 0) {
        this.definitions = new Map()
        this.state.features = { ...this.config.featureDefaults }
      }
      this.state.initialized = true

      return this.state.features
    }
  }

  async init(): Promise<FeatureDefinitions> {
    return this.fetchDefinitions()
  }

  async refresh(): Promise<FeatureDefinitions> {
    this.state.lastFetch = null
    return this.fetchDefinitions()
  }

  async isFeatureOn(
    featureKey: string,
    overrides?: EvalContextArg,
    context?: EntityContextArg,
    kind?: string,
  ): Promise<boolean> {
    if (!this.state.initialized) {
      await this.init()
    }
    return this.evaluateAndRecordCheck(featureKey, overrides, context, kind)
  }

  async isFeatureOff(
    featureKey: string,
    overrides?: EvalContextArg,
    context?: EntityContextArg,
    kind?: string,
  ): Promise<boolean> {
    const isOn = await this.isFeatureOn(featureKey, overrides, context, kind)
    return !isOn
  }

  async evaluateFeatureGate(
    featureKeys: string | string[],
    requirement: FeatureRequirement = 'all',
    negate: boolean = false,
    overrides?: EvalContextArg,
    context?: EntityContextArg,
    kind?: string,
  ): Promise<boolean> {
    if (!this.state.initialized) {
      await this.init()
    }
    const keys = normalizeFeatureKeys(featureKeys)
    return this.evaluateGateKeys(
      keys,
      requirement,
      negate,
      overrides,
      context,
      kind,
    )
  }

  getFeatures(overrides?: EvalContextArg): Record<string, boolean> {
    if (this.definitions.size === 0) {
      return { ...this.state.features }
    }
    return {
      ...this.config.featureDefaults,
      ...snapshotEvaluatedBooleans(
        this.definitions,
        this.buildEvalContext(overrides),
      ),
    }
  }

  isFeatureOnSync(
    featureKey: string,
    overrides?: EvalContextArg,
    context?: EntityContextArg,
    kind?: string,
  ): boolean {
    return this.evaluateAndRecordCheck(featureKey, overrides, context, kind)
  }

  evaluateFeatureGateSync(
    featureKeys: string | string[],
    requirement: FeatureRequirement = 'all',
    negate: boolean = false,
    overrides?: EvalContextArg,
    context?: EntityContextArg,
    kind?: string,
  ): boolean {
    const keys = normalizeFeatureKeys(featureKeys)
    return this.evaluateGateKeys(
      keys,
      requirement,
      negate,
      overrides,
      context,
      kind,
    )
  }

  recordUsage(featureKey: string, identity?: string, variant?: string): void {
    this.telemetry?.recordUsage(featureKey, identity ?? this.config.identity, variant)
  }

  recordView(featureKey: string, identity?: string, variant?: string): void {
    this.telemetry?.recordView(featureKey, identity ?? this.config.identity, variant)
  }

  measure(
    metricKey: string,
    value: number,
    options?: { feature?: string; variant?: string },
  ): void {
    this.telemetry?.measure(metricKey, value, options)
  }

  incrementCounter(
    metricKey: string,
    value = 1,
    options?: { feature?: string; variant?: string },
  ): void {
    this.telemetry?.incrementCounter(metricKey, value, options)
  }

  observe(
    metricKey: string,
    value: number,
    options?: { feature?: string; variant?: string },
  ): void {
    this.telemetry?.observe(metricKey, value, options)
  }

  async flushTelemetry(): Promise<void> {
    await this.telemetry?.flushAll()
  }

  /**
   * Schedule a best-effort flush (e.g. `waitUntil` on Cloudflare / Vercel).
   */
  scheduleFlush(waitUntil: (promise: Promise<unknown>) => void): void {
    if (!this.telemetry) return
    waitUntil(this.telemetry.flushAll())
  }

  async close(): Promise<void> {
    if (this.telemetry) {
      await this.telemetry.close()
      this.telemetry = null
    }
  }

  /** Exposed for tests — raw cached definitions. */
  getDefinitions(): Map<string, FeatureDefinitionModel> {
    return this.definitions
  }
}

function evaluateGateFallback(
  features: Record<string, boolean>,
  keys: string[],
  requirement: FeatureRequirement,
  negate: boolean,
): boolean {
  if (keys.length === 0) {
    return !negate
  }
  const result =
    requirement === 'any'
      ? keys.some((key) => features[key] === true)
      : keys.every((key) => features[key] === true)
  return negate ? !result : result
}

/**
 * Build per-request eval overrides from a Fetch Headers bag (e.g. NextRequest).
 */
export function buildEdgeEvalOverrides(
  headers: Headers | Record<string, string | string[] | undefined>,
  options: {
    identity?: string
    groups?: string[]
    claims?: Record<string, string>
  } = {},
): EvalContextOverrides {
  const ctx = fromHttpRequest(headers, {
    identity: options.identity,
    groups: options.groups,
    claims: options.claims,
  })
  return {
    identity: ctx.identity,
    groups: ctx.groups,
    claims: ctx.claims,
    request: ctx.request,
  }
}

export function createEdgeClient(config: TogglyEdgeConfig): TogglyEdgeClient {
  return new TogglyEdgeClient(config)
}

let globalEdgeClient: TogglyEdgeClient | null = null

export async function initEdgeToggly(
  config: TogglyEdgeConfig,
): Promise<TogglyEdgeClient> {
  if (globalEdgeClient) {
    await globalEdgeClient.close()
  }
  globalEdgeClient = new TogglyEdgeClient(config)
  await globalEdgeClient.init()
  return globalEdgeClient
}

export function getEdgeToggly(): TogglyEdgeClient | null {
  return globalEdgeClient
}

export async function flushEdgeTelemetry(): Promise<void> {
  await globalEdgeClient?.flushTelemetry()
}

export async function closeEdgeToggly(): Promise<void> {
  if (globalEdgeClient) {
    await globalEdgeClient.close()
    globalEdgeClient = null
  }
}

export function resetEdgeToggly(): void {
  if (globalEdgeClient) {
    void globalEdgeClient.close()
  }
  globalEdgeClient = null
}
