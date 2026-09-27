/**
 * Toggly Server-Side Client for Gatsby SSR/SSG
 *
 * Fetches definitions-signed rules and evaluates locally with @ops-ai/toggly-eval.
 * When `enableVariants` is set, switches to evaluated-variants-signed (remote
 * assignment cannot be replicated by local rule evaluation).
 */

import type {
  TogglyPluginOptions,
  Flags,
  TogglyServerClient,
  GateRequirement,
  VariantResult,
  EvaluatedVariantDef,
} from '../types/index.js';
import {
  appendEvaluationContext,
  normalizeEntityContext,
  registerContext as registerEntityContext,
  type Hook,
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
  unwrapDefsPayload,
} from '../signed-response.js';
import { parseVariantDefinitions, variantDefsToFlags } from '../variant.js';
import { decodeVariantValue } from '../decode-variant-value.js';

/**
 * Server config type with required properties except identity and hooks
 */
type ServerConfig = Required<Omit<TogglyPluginOptions, 'instanceId' | 'identity' | 'groups' | 'claims' | 'hooks' | 'localGates' | 'onError' | 'allowedKeyIds' | 'maxSignatureAgeSeconds' | 'enableLiveUpdates' | 'enableTelemetry' | 'enableUsageTracking' | 'enableMetrics' | 'metricsBaseUrl' | 'telemetryFlushIntervalMs'>> & {
  identity?: string;
  groups?: string[];
  claims?: Record<string, string>;
  hooks?: Hook[];
  localGates?: TogglyPluginOptions['localGates'];
  onError?: TogglyPluginOptions['onError'];
  allowedKeyIds?: string[];
  maxSignatureAgeSeconds?: number;
  enableLiveUpdates?: boolean;
};

interface ServerCache {
  definitions: Map<string, FeatureDefinitionModel>;
  flags: Flags;
  variantDefs: Record<string, EvaluatedVariantDef> | null;
  timestamp: number;
}

/**
 * Server-side Toggly client implementation
 */
export class TogglyServer implements TogglyServerClient {
  private config: ServerConfig;
  private cache: ServerCache | null = null;
  private fetchPromise: Promise<ServerCache> | null = null;
  private isBuildTime: boolean = false;

  constructor(config: TogglyPluginOptions, isBuildTime: boolean = false) {
    this.config = {
      baseURI: 'https://definitions.toggly.io',
      environment: 'Production',
      verifySignatures: false,
      flagDefaults: {},
      featureFlagsRefreshInterval: 3 * 60 * 1000, // 3 minutes
      isDebug: false,
      connectTimeout: 5 * 1000, // 5 seconds
      allFeaturesEnabledDuringBuild: false,
      enableVariants: false,
      ...config,
    };
    this.isBuildTime = isBuildTime;
  }

  /**
   * Get API URL — definitions-signed by default; evaluated-variants-signed when
   * `enableVariants` (variant assignment is remote).
   */
  private getApiUrl(): string {
    const { baseURI, appKey, environment, identity, groups, claims, enableVariants } = this.config;

    if (!appKey) {
      return '';
    }

    const baseUrl = baseURI.replace(/\/$/, '');

    if (enableVariants) {
      const url = new URL(`${baseUrl}/evaluated-variants-signed/${appKey}/${environment}`);
      appendEvaluationContext(url, { identity, groups, claims }, 'variants');
      return url.toString();
    }

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
    return age < this.config.featureFlagsRefreshInterval;
  }

  private defaultsOnlyCache(enableVariants: boolean): ServerCache {
    return {
      definitions: new Map(),
      flags: { ...this.config.flagDefaults },
      variantDefs: enableVariants ? {} : null,
      timestamp: Date.now(),
    };
  }

  /**
   * Fetch definitions from Toggly API and snapshot evaluated booleans
   * (or variant defs when enableVariants).
   */
  private async fetchFlags(): Promise<ServerCache> {
    const url = this.getApiUrl();
    const enableVariants = this.config.enableVariants === true;

    // If no appKey, return flagDefaults
    if (!url || !this.config.appKey) {
      if (this.config.isDebug) {
        console.log('[Toggly Server] Using flag defaults (no appKey):', this.config.flagDefaults);
      }
      return this.defaultsOnlyCache(enableVariants);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.connectTimeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: buildDefinitionFetchHeaders({
          Accept: 'application/json',
        }),
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
        baseURI: this.config.baseURI,
        allowedKeyIds: this.config.allowedKeyIds,
        maxSignatureAgeSeconds: this.config.maxSignatureAgeSeconds,
        headers: buildDefinitionFetchHeaders({ Accept: 'application/json' }),
      });

      let definitions = new Map<string, FeatureDefinitionModel>();
      let flags: Flags;
      let variantDefs: Record<string, EvaluatedVariantDef> | null;

      if (enableVariants) {
        variantDefs = parseVariantDefinitions(unwrapDefsPayload(payload));
        flags = variantDefsToFlags(variantDefs);
      } else {
        definitions = parseDefinitionsPayload(payload);
        flags = {
          ...this.config.flagDefaults,
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

        const allKeys = new Set([
          ...definitions.keys(),
          ...Object.keys(flags),
          ...Object.keys(this.config.flagDefaults),
        ]);

        flags = Array.from(allKeys).reduce((acc, key) => {
          acc[key] = true;
          return acc;
        }, {} as Flags);

        // Keep getVariant consistent with forced-on flags during SSG.
        if (variantDefs) {
          const enabledVariantDefs: Record<string, EvaluatedVariantDef> = {};
          for (const [key, entry] of Object.entries(variantDefs)) {
            enabledVariantDefs[key] = { ...entry, enabled: true };
          }
          variantDefs = enabledVariantDefs;
        }
      }

      if (this.config.isDebug) {
        console.log('[Toggly Server] Fetched definitions:', definitions.size, 'flags:', flags);
        if (enableVariants && variantDefs) {
          console.log('[Toggly Server] Fetched variant defs:', variantDefs);
        }
      }

      return {
        definitions,
        flags,
        variantDefs,
        timestamp: Date.now(),
      };
    } catch (error) {
      if (this.config.isDebug) {
        console.error('[Toggly Server] Error fetching flags:', error);
      }

      // On error, try to use cached flags, otherwise use flagDefaults
      if (this.cache) {
        if (this.config.isDebug) {
          console.log('[Toggly Server] Using cached flags:', this.cache.flags);
        }
        return {
          definitions: this.cache.definitions,
          flags: { ...this.cache.flags },
          variantDefs: this.cache.variantDefs,
          timestamp: this.cache.timestamp,
        };
      }

      if (this.config.isDebug) {
        console.log('[Toggly Server] Using flag defaults:', this.config.flagDefaults);
      }

      return this.defaultsOnlyCache(enableVariants);
    }
  }

  /**
   * Refresh flags cache
   */
  async refreshFlags(): Promise<void> {
    if (this.config.isDebug) {
      console.log('[Toggly Server] Refreshing flags...');
    }

    // Prevent multiple concurrent fetches
    if (this.fetchPromise) {
      await this.fetchPromise;
      return;
    }

    this.fetchPromise = this.fetchFlags();

    try {
      this.cache = await this.fetchPromise;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async ensureCache(): Promise<ServerCache> {
    if (!this.config.appKey) {
      return this.defaultsOnlyCache(this.config.enableVariants === true);
    }

    if (this.isCacheValid() && this.cache) {
      return this.cache;
    }

    await this.refreshFlags();
    return (
      this.cache ?? this.defaultsOnlyCache(this.config.enableVariants === true)
    );
  }

  /**
   * Get all feature flags (boolean snapshot)
   */
  async getFlags(): Promise<Flags> {
    const cache = await this.ensureCache();
    return { ...cache.flags };
  }

  /**
   * Get a single feature flag value (local evaluation, or boolean snapshot in variant mode)
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
      return this.config.flagDefaults[key] ?? defaultValue;
    }

    const def = cache.definitions.get(key);

    if (def) {
      return evaluateDefinition(def, this.buildEvalContext(entityContext));
    }

    // Check flagDefaults first, then use provided defaultValue
    return this.config.flagDefaults[key] ?? defaultValue;
  }

  /**
   * Evaluate a feature gate with multiple flags (local evaluation)
   */
  async evaluateGate(
    keys: string[],
    requirement: GateRequirement = 'all',
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
      const passed = requirement === 'any' ? results.some(Boolean) : results.every(Boolean);
      return negate ? !passed : passed;
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

    const entry = this.cache?.variantDefs?.[featureKey];
    if (!entry?.variant || entry.enabled !== true) {
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
  async getVariantValue<T = unknown>(
    featureKey: string,
    isT?: (v: unknown) => v is T,
  ): Promise<T | null> {
    const variant = await this.getVariant(featureKey);
    return decodeVariantValue(variant?.configurationValue, isT);
  }
}

/**
 * Create a new Toggly server-side client instance
 */
export function createTogglyServerClient(
  config: TogglyPluginOptions,
  isBuildTime: boolean = false
): TogglyServer {
  return new TogglyServer(config, isBuildTime);
}
