import {
  evaluateGate,
  generateUUID,
  normalizeFeatureKeys,
  toBooleanDefinitions,
  DEFAULT_CONFIG,
  API_ENDPOINTS,
  type FeatureDefinitions,
  type FeatureDefinitionsResponse,
  type FeatureRequirement,
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

/**
 * Edge-compatible Toggly client
 * Designed to work in Edge Runtime (Vercel Edge, Cloudflare Workers)
 */
export class TogglyEdgeClient {
  private config: TogglyEdgeConfig
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

    // Initialize with defaults
    this.state.features = { ...this.config.featureDefaults }

    // Generate identity if not provided
    if (!this.config.identity) {
      this.config.identity = generateUUID()
    }
  }

  /**
   * Get current state
   */
  getState(): EdgeClientState {
    return { ...this.state }
  }

  /**
   * Get current identity
   */
  get identity(): string | undefined {
    return this.config.identity
  }

  /**
   * Set identity
   */
  set identity(value: string | undefined) {
    this.config.identity = value
  }

  /**
   * Fetch feature definitions from the API
   */
  async fetchDefinitions(): Promise<FeatureDefinitions> {
    if (!this.config.appKey) {
      console.warn('[Toggly Edge] No appKey provided, using defaults only')
      return { ...this.config.featureDefaults }
    }

    // Check cache TTL
    if (
      this.config.cache &&
      this.state.lastFetch &&
      this.state.initialized
    ) {
      const elapsed = Date.now() - this.state.lastFetch
      const ttlMs = (this.config.cacheTtl ?? 60) * 1000
      if (elapsed < ttlMs) {
        return this.state.features
      }
    }

    const url = API_ENDPOINTS.definitions(
      this.config.baseUri ?? DEFAULT_CONFIG.baseUri,
      this.config.appKey,
      this.config.environment ?? DEFAULT_CONFIG.environment
    )

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.config.identity) {
      headers['x-toggly-identity'] = this.config.identity
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

      const definitions: FeatureDefinitions = {}
      if (this.config.verifySignatures) {
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          Object.assign(definitions, parsed as FeatureDefinitions)
        }
      } else {
        const data = parsed as FeatureDefinitionsResponse
        if (data.features && Array.isArray(data.features)) {
          for (const feature of data.features) {
            definitions[feature.featureKey] = feature.enabled
          }
        } else if (data.defs) {
          Object.assign(definitions, data.defs)
        } else if (parsed && typeof parsed === 'object') {
          Object.assign(definitions, parsed as FeatureDefinitions)
        }
      }

      // Merge with defaults (API takes precedence). Edge middleware has no entity
      // context, so gated definitions collapse to false rather than leaking objects.
      this.state.features = toBooleanDefinitions({
        ...this.config.featureDefaults,
        ...definitions,
      })
      this.state.lastFetch = Date.now()
      this.state.initialized = true
      this.state.error = null

      return this.state.features
    } catch (error) {
      console.error('[Toggly Edge] Failed to fetch feature definitions:', error)
      this.state.error = error as Error
      this.config.onError?.('Error fetching feature flags', error)

      // Fall back to defaults only when no last-known-good state exists.
      if (!this.state.initialized || Object.keys(this.state.features).length === 0) {
        this.state.features = { ...this.config.featureDefaults }
      }
      this.state.initialized = true

      return this.state.features
    }
  }

  /**
   * Initialize the client
   */
  async init(): Promise<FeatureDefinitions> {
    return this.fetchDefinitions()
  }

  /**
   * Refresh feature definitions
   */
  async refresh(): Promise<FeatureDefinitions> {
    this.state.lastFetch = null // Force refresh
    return this.fetchDefinitions()
  }

  /**
   * Check if a feature is enabled
   */
  async isFeatureOn(featureKey: string): Promise<boolean> {
    if (!this.state.initialized) {
      await this.init()
    }
    return this.state.features[featureKey] === true
  }

  /**
   * Check if a feature is disabled
   */
  async isFeatureOff(featureKey: string): Promise<boolean> {
    const isOn = await this.isFeatureOn(featureKey)
    return !isOn
  }

  /**
   * Evaluate a feature gate
   */
  async evaluateFeatureGate(
    featureKeys: string | string[],
    requirement: FeatureRequirement = 'all',
    negate: boolean = false
  ): Promise<boolean> {
    if (!this.state.initialized) {
      await this.init()
    }

    const keys = normalizeFeatureKeys(featureKeys)
    return evaluateGate(this.state.features, keys, requirement, negate)
  }

  /**
   * Get all features
   */
  getFeatures(): Record<string, boolean> {
    return { ...this.state.features }
  }

  /**
   * Check feature synchronously (uses cached values)
   * Only use after init() has been called
   */
  isFeatureOnSync(featureKey: string): boolean {
    return this.state.features[featureKey] === true
  }

  /**
   * Check feature gate synchronously
   * Only use after init() has been called
   */
  evaluateFeatureGateSync(
    featureKeys: string | string[],
    requirement: FeatureRequirement = 'all',
    negate: boolean = false
  ): boolean {
    const keys = normalizeFeatureKeys(featureKeys)
    return evaluateGate(this.state.features, keys, requirement, negate)
  }
}

/**
 * Create an edge client instance
 */
export function createEdgeClient(config: TogglyEdgeConfig): TogglyEdgeClient {
  return new TogglyEdgeClient(config)
}

// Global edge client for singleton pattern
let globalEdgeClient: TogglyEdgeClient | null = null

/**
 * Initialize the global edge client
 */
export async function initEdgeToggly(
  config: TogglyEdgeConfig
): Promise<TogglyEdgeClient> {
  globalEdgeClient = new TogglyEdgeClient(config)
  await globalEdgeClient.init()
  return globalEdgeClient
}

/**
 * Get the global edge client
 */
export function getEdgeToggly(): TogglyEdgeClient | null {
  return globalEdgeClient
}

/**
 * Reset the global edge client (for testing)
 */
export function resetEdgeToggly(): void {
  globalEdgeClient = null
}
