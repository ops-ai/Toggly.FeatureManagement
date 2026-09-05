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

/**
 * Edge-compatible Toggly client.
 * Fetches identity-agnostic definitions-signed payloads and evaluates per call
 * with overrides (never mutates shared identity for targeting).
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

  private evaluateGateKeys(
    featureKeys: string[],
    requirement: FeatureRequirement,
    negate: boolean,
    overrides?: EvalContextArg,
    entityContext?: EntityContextArg,
    kind?: string,
  ): boolean {
    if (this.definitions.size === 0) {
      return evaluateGateFallback(
        this.state.features,
        featureKeys,
        requirement,
        negate,
      )
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
    return this.evaluateFlag(featureKey, overrides, context, kind)
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
    return this.evaluateFlag(featureKey, overrides, context, kind)
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
  globalEdgeClient = new TogglyEdgeClient(config)
  await globalEdgeClient.init()
  return globalEdgeClient
}

export function getEdgeToggly(): TogglyEdgeClient | null {
  return globalEdgeClient
}

export function resetEdgeToggly(): void {
  globalEdgeClient = null
}
