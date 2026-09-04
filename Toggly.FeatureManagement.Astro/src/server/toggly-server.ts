/**
 * Toggly Server-Side Client for Astro SSR/SSG
 *
 * Fetches definitions-signed rules and evaluates locally with @ops-ai/toggly-eval.
 * Variant mode still uses evaluated-variants-signed (variant assignment is remote).
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

interface CachedFlags {
  flags: Flags;
  definitions: Map<string, FeatureDefinitionModel>;
  variantDefs: Record<string, EvaluatedVariantDef> | null;
  timestamp: number;
}

/**
 * Server-side Toggly client implementation
 */
export class TogglyServer implements TogglyClient {
  private config: TogglyConfig;
  private cache: CachedFlags | null = null;
  private fetchPromise: Promise<CachedFlags> | null = null;
  private isBuildTime: boolean = false;

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

  /**
   * Fetch flags (and optional variant defs) from Toggly API
   */
  private async fetchFlags(): Promise<CachedFlags> {
    const url = this.getApiUrl();
    const enableVariants = this.config.enableVariants === true;

    // If no appKey, return flagDefaults
    if (!url || !this.config.appKey) {
      if (this.config.isDebug) {
        console.log('[Toggly Server] Using flag defaults (no appKey):', this.config.flagDefaults);
      }
      return {
        flags: { ...this.config.flagDefaults! },
        definitions: new Map(),
        variantDefs: enableVariants ? {} : null,
        timestamp: Date.now(),
      };
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
        flags,
        definitions,
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
          flags: { ...this.cache.flags },
          definitions: this.cache.definitions,
          variantDefs: this.cache.variantDefs,
          timestamp: this.cache.timestamp,
        };
      }

      if (this.config.isDebug) {
        console.log('[Toggly Server] Using flag defaults:', this.config.flagDefaults);
      }

      return {
        flags: { ...this.config.flagDefaults! },
        definitions: new Map(),
        variantDefs: enableVariants ? {} : null,
        timestamp: Date.now(),
      };
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

  private async ensureCache(): Promise<CachedFlags> {
    if (!this.config.appKey) {
      return {
        flags: { ...this.config.flagDefaults! },
        definitions: new Map(),
        variantDefs: this.config.enableVariants ? {} : null,
        timestamp: Date.now(),
      };
    }

    if (this.isCacheValid() && this.cache) {
      return this.cache;
    }

    await this.refreshFlags();
    return (
      this.cache ?? {
        flags: { ...this.config.flagDefaults! },
        definitions: new Map(),
        variantDefs: this.config.enableVariants ? {} : null,
        timestamp: Date.now(),
      }
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
