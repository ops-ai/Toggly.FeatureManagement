/**
 * Toggly Server-Side Client for Astro SSR/SSG
 * 
 * This module provides server-side feature flag evaluation for Astro applications.
 * It caches flags for SSG builds and fetches fresh flags for SSR requests.
 * This is a complete, embedded Toggly client implementation.
 */

import type {
  TogglyConfig,
  Flags,
  TogglyClient,
  VariantResult,
  EvaluatedVariantDef,
} from '../types/index.js';
import { parseVariantDefsPayload, variantDefsToFlags } from '../variant-helpers.js';
import { appendEvaluationContext } from '@ops-ai/toggly-hooks-types';
import { buildDefinitionFetchHeaders } from '../sdk-identity.js';

interface CachedFlags {
  flags: Flags;
  variantDefs: Record<string, EvaluatedVariantDef> | null;
  timestamp: number;
}

/**
 * Server-side Toggly client implementation
 */
export class TogglyServer implements TogglyClient {
  private config: TogglyConfig;
  private cache: CachedFlags | null = null;
  private fetchPromise: Promise<{ flags: Flags; variantDefs: Record<string, EvaluatedVariantDef> | null }> | null =
    null;
  private isBuildTime: boolean = false;

  constructor(config: TogglyConfig, isBuildTime: boolean = false) {
    this.config = {
      baseURI: 'https://definitions.toggly.io',
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
   * Get API URL for fetching flags (or variants when enableVariants is true)
   */
  private getApiUrl(): string {
    const { baseURI, appKey, environment, identity, groups, claims, enableVariants } = this.config;

    if (!appKey) {
      return '';
    }

    const baseUrl = baseURI!.replace(/\/$/, '');
    const path = enableVariants
      ? `/evaluated-variants-signed/${appKey}/${environment}`
      : `/evaluated-signed/${appKey}/${environment}`;
    const url = new URL(`${baseUrl}${path}`);

    appendEvaluationContext(
      url,
      { identity, groups, claims },
      enableVariants ? 'variants' : 'evaluated',
    );

    return url.toString();
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
  private async fetchFlags(): Promise<{ flags: Flags; variantDefs: Record<string, EvaluatedVariantDef> | null }> {
    const url = this.getApiUrl();
    const enableVariants = this.config.enableVariants === true;

    // If no appKey, return flagDefaults
    if (!url || !this.config.appKey) {
      if (this.config.isDebug) {
        console.log('[Toggly Server] Using flag defaults (no appKey):', this.config.flagDefaults);
      }
      return {
        flags: { ...this.config.flagDefaults! },
        variantDefs: enableVariants ? {} : null,
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

      const payload = await response.json();
      let flags: Flags;
      let variantDefs: Record<string, EvaluatedVariantDef> | null;

      if (enableVariants) {
        variantDefs = parseVariantDefsPayload(payload);
        flags = variantDefsToFlags(variantDefs);
      } else if (typeof payload === 'object' && payload !== null && 'defs' in payload && typeof payload.defs === 'object') {
        flags = payload.defs as Flags;
        variantDefs = null;
      } else {
        flags = payload as Flags;
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

      return { flags, variantDefs };
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
          variantDefs: this.cache.variantDefs,
        };
      }

      if (this.config.isDebug) {
        console.log('[Toggly Server] Using flag defaults:', this.config.flagDefaults);
      }

      return {
        flags: { ...this.config.flagDefaults! },
        variantDefs: enableVariants ? {} : null,
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
      const { flags, variantDefs } = await this.fetchPromise;
      this.cache = {
        flags,
        variantDefs,
        timestamp: Date.now(),
      };
    } finally {
      this.fetchPromise = null;
    }
  }

  /**
   * Get all feature flags
   */
  async getFlags(): Promise<Flags> {
    // If no appKey, return flagDefaults immediately
    if (!this.config.appKey) {
      return { ...this.config.flagDefaults! };
    }

    // If cache is valid, return it
    if (this.isCacheValid() && this.cache) {
      return { ...this.cache.flags };
    }

    // Otherwise, refresh and return
    await this.refreshFlags();
    return this.cache ? { ...this.cache.flags } : { ...this.config.flagDefaults! };
  }

  /**
   * Get a single feature flag value
   */
  async getFlag(key: string, defaultValue: boolean = false): Promise<boolean> {
    const flags = await this.getFlags();
    const value = flags[key];

    if (value !== undefined) {
      return value;
    }

    // Check flagDefaults first, then use provided defaultValue
    return this.config.flagDefaults?.[key] ?? defaultValue;
  }

  /**
   * Evaluate a feature gate with multiple flags
   */
  async evaluateGate(
    keys: string[],
    requirement: 'all' | 'any' = 'all',
    negate: boolean = false
  ): Promise<boolean> {
    if (keys.length === 0) {
      return !negate;
    }

    const flags = await this.getFlags();

    let isEnabled: boolean;

    if (requirement === 'any') {
      // At least one flag must be true
      isEnabled = keys.some((key) => flags[key] === true);
    } else {
      // All flags must be true
      isEnabled = keys.every((key) => flags[key] === true);
    }

    return negate ? !isEnabled : isEnabled;
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


