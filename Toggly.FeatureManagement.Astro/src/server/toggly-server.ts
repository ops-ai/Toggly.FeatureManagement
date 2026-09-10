/**
 * Toggly Server-Side Client for Astro SSR/SSG
 *
 * Fetches definitions-signed rules and evaluates locally with @ops-ai/toggly-eval.
 * Variant mode still uses evaluated-variants-signed (variant assignment is remote).
 *
 * Definition-refresh cache hits/misses are reported on the usage pipeline
 * (`POST api/usage/stats`). N/A on this server client: WebSocket live updates,
 * durable snapshot hydrate, HTTP 304 / etag equal-revision (no If-None-Match).
 * Full Metrics.SendMetrics parity is out of scope for this package slice.
 */

import type {
  TogglyConfig,
  Flags,
  TogglyClient,
  VariantResult,
  EvaluatedVariantDef,
} from '../types/index.js';
import { parseVariantDefsPayload, variantDefsToFlags } from '../variant-helpers.js';
import {
  appendEvaluationContext,
  normalizeEntityContext,
  registerContext as registerEntityContext,
} from '@ops-ai/toggly-hooks-types';
import {
  evaluateDefinition,
  evaluateFeatureGate,
  parseDefinitionsPayload,
  snapshotEvaluatedBooleans,
  type FeatureDefinitionModel,
  type EvalContext,
} from '@ops-ai/toggly-eval';
import { buildDefinitionFetchHeaders } from '../sdk-identity.js';
import {
  parseEvaluatedResponseBody,
  readResponseBody,
} from '../signed-response.js';
import {
  UsageTelemetryRuntime,
  resolveTelemetryEnableFlag,
  type UsageSender,
} from '../telemetry/index.js';

interface CachedFlags {
  flags: Flags;
  definitions: Map<string, FeatureDefinitionModel>;
  variantDefs: Record<string, EvaluatedVariantDef> | null;
  timestamp: number;
  /** True when this entry came from a real definitions payload (not flagDefaults-only). */
  fromNetwork: boolean;
}

/**
 * Server-side Toggly client implementation
 */
export class TogglyServer implements TogglyClient {
  private config: TogglyConfig;
  private cache: CachedFlags | null = null;
  private fetchPromise: Promise<CachedFlags> | null = null;
  private isBuildTime: boolean = false;
  private telemetry: UsageTelemetryRuntime | null = null;
  /**
   * Once we have counted a TTL skip for a given cache timestamp, further
   * getFlag/getFlags calls in the same TTL window do not increment again
   * (one outcome per refresh attempt, not per evaluate).
   */
  private ttlHitCountedForTimestamp: number | null = null;

  constructor(config: TogglyConfig, isBuildTime: boolean = false) {
    this.config = {
      baseURI: 'https://definitions.toggly.io',
      verifySignatures: false,
      environment: 'Production',
      flagDefaults: {},
      featureFlagsRefreshInterval: 3 * 60 * 1000, // 3 minutes
      isDebug: false,
      connectTimeout: 5 * 1000, // 5 seconds
      allFeaturesEnabledDuringBuild: false,
      enableVariants: false,
      ...config,
    };
    this.isBuildTime = isBuildTime;
    this.startTelemetry();
  }

  private startTelemetry(): void {
    if (!this.config.appKey) {
      return;
    }

    const enableUsageTracking = resolveTelemetryEnableFlag(
      this.config.enableUsageTracking,
      true,
    );
    if (!enableUsageTracking) {
      return;
    }

    this.telemetry = new UsageTelemetryRuntime({
      appKey: this.config.appKey,
      environment: this.config.environment ?? 'Production',
      metricsBaseUrl: this.config.metricsBaseUrl,
      enableUsageTracking: true,
      usageFlushInterval: this.config.usageFlushInterval,
      instanceName: this.config.instanceName ?? 'astro-ssr',
      // Consuming-app version only; SDK identity is User-Agent / X-Toggly-Sdk-*.
      appVersion: this.config.appVersion,
      attachProcessHandlers: this.config.telemetryAttachProcessHandlers ?? true,
      restoreOnSendFailure: true,
      fetchImpl: this.config.telemetryFetch,
      usageClient: this.config.usageClient as UsageSender | null | undefined,
    });
    this.telemetry.start();
  }

  private recordDefinitionCacheHit(): void {
    try {
      this.telemetry?.recordDefinitionCacheHit();
    } catch {
      // Telemetry must never break flag refresh.
    }
  }

  private recordDefinitionCacheMiss(): void {
    try {
      this.telemetry?.recordDefinitionCacheMiss();
    } catch {
      // Telemetry must never break flag refresh.
    }
  }

  /** Flush pending usage stats (including cache-only batches). */
  async flushTelemetry(): Promise<void> {
    await this.telemetry?.flush();
  }

  /** Flush and tear down usage telemetry. */
  async close(options?: { timeoutMs?: number }): Promise<void> {
    await this.telemetry?.close(options);
    this.telemetry = null;
  }

  /**
   * Get API URL for fetching definitions (or evaluated variants when enableVariants).
   */
  private getApiUrl(): string {
    const { baseURI, appKey, environment, identity, groups, claims, enableVariants } = this.config;

    if (!appKey) {
      return '';
    }

    const baseUrl = baseURI!.replace(/\/$/, '');

    // Variants still need remote assignment; keep evaluated-variants-signed.
    if (enableVariants) {
      const url = new URL(`${baseUrl}/evaluated-variants-signed/${appKey}/${environment}`);
      appendEvaluationContext(url, { identity, groups, claims }, 'variants');
      return url.toString();
    }

    // Default server rail: definitions-signed, no identity query (OPS-825).
    return `${baseUrl}/definitions-signed/${appKey}/${environment}`;
  }

  private buildEvalContext(
    entity?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | null,
  ): EvalContext {
    return {
      identity: this.config.identity,
      groups: this.config.groups,
      traits: this.config.claims,
      claims: this.config.claims,
      entity: entity ?? null,
    };
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(): boolean {
    if (!this.cache) return false;
    const age = Date.now() - this.cache.timestamp;
    return age < this.config.featureFlagsRefreshInterval!;
  }

  private defaultsOnlyCache(enableVariants: boolean): CachedFlags {
    return {
      flags: { ...this.config.flagDefaults! },
      definitions: new Map(),
      variantDefs: enableVariants ? {} : null,
      timestamp: Date.now(),
      fromNetwork: false,
    };
  }

  /**
   * Fetch flags (and optional variant defs) from Toggly API.
   * Returns a result plus whether this call applied a new network revision (miss)
   * or served last-good cache after error (hit). Defaults-only is neither.
   */
  private async fetchFlags(): Promise<{
    cache: CachedFlags;
    outcome: 'miss' | 'hit' | 'none';
  }> {
    const url = this.getApiUrl();
    const enableVariants = this.config.enableVariants === true;

    // If no appKey, return flagDefaults — not a cache hit.
    if (!url || !this.config.appKey) {
      if (this.config.isDebug) {
        console.log('[Toggly Server] Using flag defaults (no appKey):', this.config.flagDefaults);
      }
      return { cache: this.defaultsOnlyCache(enableVariants), outcome: 'none' };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.connectTimeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: buildDefinitionFetchHeaders({
          Accept: 'application/json',
        }),
        cache: 'no-store',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch flags from Toggly API: ${response.status} ${response.statusText}`
        );
      }

      const bodyText = await readResponseBody(response);
      const payload = await parseEvaluatedResponseBody(bodyText, {
        verifySignatures: this.config.verifySignatures,
        baseURI: this.config.baseURI!,
        allowedKeyIds: this.config.allowedKeyIds,
        maxSignatureAgeSeconds: this.config.maxSignatureAgeSeconds,
        headers: buildDefinitionFetchHeaders({ Accept: 'application/json' }),
      });

      let flags: Flags;
      let definitions: Map<string, FeatureDefinitionModel> = new Map();
      let variantDefs: Record<string, EvaluatedVariantDef> | null;

      if (enableVariants) {
        // Verified path returns raw defs; unverified may still be `{ defs }`.
        variantDefs = parseVariantDefsPayload(
          this.config.verifySignatures ? { defs: payload } : payload
        );
        flags = variantDefsToFlags(variantDefs);
      } else {
        definitions = parseDefinitionsPayload(payload);
        flags = {
          ...this.config.flagDefaults!,
          ...snapshotEvaluatedBooleans(definitions, this.buildEvalContext()),
        };
        variantDefs = null;
      }

      // If allFeaturesEnabledDuringBuild is true and we're in build time,
      // override all flags to true
      if (this.config.allFeaturesEnabledDuringBuild && this.isBuildTime) {
        if (this.config.isDebug) {
          console.log('[Toggly Server] Build mode: Enabling all features');
        }
        flags = Object.keys(flags).reduce((acc, key) => {
          acc[key] = true;
          return acc;
        }, {} as Flags);
      }

      if (this.config.isDebug) {
        console.log('[Toggly Server] Fetched flags:', flags);
        if (enableVariants && variantDefs) {
          console.log('[Toggly Server] Fetched variant defs:', variantDefs);
        }
      }

      return {
        cache: {
          flags,
          definitions,
          variantDefs,
          timestamp: Date.now(),
          fromNetwork: true,
        },
        outcome: 'miss',
      };
    } catch (error) {
      if (this.config.isDebug) {
        console.error('[Toggly Server] Error fetching flags:', error);
      }

      // On error, try to use cached flags from a prior network apply — cache hit.
      // flagDefaults-only (no prior network cache) is not a hit (Nuxt Seer lesson).
      if (this.cache?.fromNetwork) {
        if (this.config.isDebug) {
          console.log('[Toggly Server] Using cached flags:', this.cache.flags);
        }
        return {
          cache: {
            flags: { ...this.cache.flags },
            definitions: this.cache.definitions,
            variantDefs: this.cache.variantDefs,
            timestamp: this.cache.timestamp,
            fromNetwork: true,
          },
          outcome: 'hit',
        };
      }

      if (this.config.isDebug) {
        console.log('[Toggly Server] Using flag defaults:', this.config.flagDefaults);
      }

      return { cache: this.defaultsOnlyCache(enableVariants), outcome: 'none' };
    }
  }

  /**
   * Refresh flags cache.
   * Counts one definition-refresh hit/miss per performed attempt.
   * Concurrent in-flight skips do not count.
   */
  async refreshFlags(): Promise<void> {
    if (this.config.isDebug) {
      console.log('[Toggly Server] Refreshing flags...');
    }

    // Prevent multiple concurrent fetches — do not count the waiter.
    if (this.fetchPromise) {
      await this.fetchPromise;
      return;
    }

    this.fetchPromise = this.fetchFlags().then((result) => {
      if (result.outcome === 'miss') {
        this.recordDefinitionCacheMiss();
      } else if (result.outcome === 'hit') {
        this.recordDefinitionCacheHit();
        // Same cache generation already recorded; avoid a duplicate TTL hit.
        this.ttlHitCountedForTimestamp = result.cache.timestamp;
      }
      return result.cache;
    });

    try {
      this.cache = await this.fetchPromise;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async ensureCache(): Promise<CachedFlags> {
    if (!this.config.appKey) {
      return this.defaultsOnlyCache(this.config.enableVariants === true);
    }

    if (this.isCacheValid() && this.cache) {
      // TTL still valid / skip network → hit (once per cache generation).
      if (
        this.cache.fromNetwork &&
        this.ttlHitCountedForTimestamp !== this.cache.timestamp
      ) {
        this.recordDefinitionCacheHit();
        this.ttlHitCountedForTimestamp = this.cache.timestamp;
      }
      return this.cache;
    }

    await this.refreshFlags();
    return (
      this.cache ?? this.defaultsOnlyCache(this.config.enableVariants === true)
    );
  }

  /**
   * Get all feature flags
   */
  async getFlags(): Promise<Flags> {
    const cache = await this.ensureCache();
    return { ...cache.flags };
  }

  /**
   * Get a single feature flag value
   */
  async getFlag(
    key: string,
    defaultValue: boolean = false,
    entity?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean> {
    const cache = await this.ensureCache();
    const entityContext = normalizeEntityContext(entity, kind);

    if (this.config.enableVariants) {
      const value = cache.flags[key];
      if (value !== undefined) {
        return typeof value === 'boolean' ? value : defaultValue;
      }
      return this.config.flagDefaults?.[key] ?? defaultValue;
    }

    const def = cache.definitions.get(key);
    if (def) {
      return evaluateDefinition(def, this.buildEvalContext(entityContext));
    }

    return this.config.flagDefaults?.[key] ?? defaultValue;
  }

  /**
   * Evaluate a feature gate with multiple flags
   */
  async evaluateGate(
    keys: string[],
    requirement: 'all' | 'any' = 'all',
    negate: boolean = false,
    entity?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean> {
    if (keys.length === 0) {
      return !negate;
    }

    const cache = await this.ensureCache();
    const entityContext = normalizeEntityContext(entity, kind);

    if (this.config.enableVariants) {
      const results = keys.map((key) => {
        const value = cache.flags[key];
        return typeof value === 'boolean' ? value : false;
      });
      const result =
        requirement === 'any' ? results.some(Boolean) : results.every(Boolean);
      return negate ? !result : result;
    }

    return evaluateFeatureGate(
      cache.definitions,
      keys,
      requirement,
      negate,
      this.buildEvalContext(entityContext),
    );
  }

  registerContext<T>(
    kind: string,
    mapper: (entity: T) => import('@ops-ai/toggly-hooks-types').TogglyEntityContext,
  ): void {
    registerEntityContext(kind, mapper);
  }

  /**
   * Current variant assignment for a feature (requires enableVariants).
   */
  async getVariant(featureKey: string): Promise<VariantResult | null> {
    if (!this.config.enableVariants) {
      return null;
    }

    await this.getFlags();

    const defs = this.cache?.variantDefs;
    if (!defs) {
      return null;
    }

    const entry = defs[featureKey];
    if (!entry?.variant) {
      return null;
    }

    return {
      name: entry.variant,
      configurationValue: entry.configurationValue,
    };
  }

  /**
   * Configuration payload for the assigned variant, if any.
   */
  async getVariantValue(featureKey: string): Promise<unknown | null> {
    const variant = await this.getVariant(featureKey);
    return variant?.configurationValue ?? null;
  }
}

/**
 * Create a new Toggly server-side client instance
 */
export function createTogglyServerClient(config: TogglyConfig, isBuildTime: boolean = false): TogglyServer {
  return new TogglyServer(config, isBuildTime);
}
