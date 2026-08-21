/**
 * Toggly Server-Side Client for Gatsby SSR/SSG
 * 
 * This module provides server-side feature flag evaluation for Gatsby applications.
 * It caches flags for SSG builds and fetches fresh flags for SSR requests.
 * This is a complete, embedded Toggly client implementation.
 */

import type {
  TogglyPluginOptions,
  Flags,
  TogglyServerClient,
  CachedFlags,
  GateRequirement,
} from '../types/index.js';
import { appendEvaluationContext, evaluateEvaluatedGate, normalizeEntityContext, registerContext as registerEntityContext, resolveEvaluatedDefinition, type Hook } from '@ops-ai/toggly-hooks-types';
import { buildDefinitionFetchHeaders } from '../sdk-identity.js';
import {
  parseEvaluatedResponseBody,
  readResponseBody,
  unwrapDefsPayload,
} from '../signed-response.js';

/**
 * Server config type with required properties except identity and hooks
 */
type ServerConfig = Required<Omit<TogglyPluginOptions, 'identity' | 'groups' | 'claims' | 'hooks' | 'localGates' | 'onError' | 'allowedKeyIds' | 'maxSignatureAgeSeconds'>> & {
  identity?: string;
  groups?: string[];
  claims?: Record<string, string>;
  hooks?: Hook[];
  localGates?: TogglyPluginOptions['localGates'];
  onError?: TogglyPluginOptions['onError'];
  allowedKeyIds?: string[];
  maxSignatureAgeSeconds?: number;
};

/**
 * Server-side Toggly client implementation
 */
export class TogglyServer implements TogglyServerClient {
  private config: ServerConfig;
  private cache: CachedFlags | null = null;
  private fetchPromise: Promise<Flags> | null = null;
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
      ...config,
    };
    this.isBuildTime = isBuildTime;
  }

  /**
   * Get API URL for fetching flags
   */
  private getApiUrl(): string {
    const { baseURI, appKey, environment, identity, groups, claims } = this.config;

    if (!appKey) {
      return '';
    }

    const baseUrl = baseURI.replace(/\/$/, '');
    const url = new URL(`${baseUrl}/evaluated-signed/${appKey}/${environment}`);

    appendEvaluationContext(url, { identity, groups, claims }, 'evaluated');

    return url.toString();
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(): boolean {
    if (!this.cache) return false;
    const age = Date.now() - this.cache.timestamp;
    return age < this.config.featureFlagsRefreshInterval;
  }

  /**
   * Fetch flags from Toggly API
   */
  private async fetchFlags(): Promise<Flags> {
    const url = this.getApiUrl();

    // If no appKey, return flagDefaults
    if (!url || !this.config.appKey) {
      if (this.config.isDebug) {
        console.log('[Toggly Server] Using flag defaults (no appKey):', this.config.flagDefaults);
      }
      return { ...this.config.flagDefaults };
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
      let flags = unwrapDefsPayload(payload) as Flags;

      // If allFeaturesEnabledDuringBuild is true and we're in build time,
      // override all flags to true
      if (this.config.allFeaturesEnabledDuringBuild && this.isBuildTime) {
        if (this.config.isDebug) {
          console.log('[Toggly Server] Build mode: Enabling all features');
        }
        
        // Enable all flags AND all flagDefaults
        const allKeys = new Set([
          ...Object.keys(flags),
          ...Object.keys(this.config.flagDefaults),
        ]);
        
        flags = Array.from(allKeys).reduce((acc, key) => {
          acc[key] = true;
          return acc;
        }, {} as Flags);
      }

      if (this.config.isDebug) {
        console.log('[Toggly Server] Fetched flags:', flags);
      }

      return flags;
    } catch (error) {
      if (this.config.isDebug) {
        console.error('[Toggly Server] Error fetching flags:', error);
      }

      // On error, try to use cached flags, otherwise use flagDefaults
      if (this.cache) {
        if (this.config.isDebug) {
          console.log('[Toggly Server] Using cached flags:', this.cache.flags);
        }
        return { ...this.cache.flags };
      }

      if (this.config.isDebug) {
        console.log('[Toggly Server] Using flag defaults:', this.config.flagDefaults);
      }

      return { ...this.config.flagDefaults };
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
      const flags = await this.fetchPromise;
      this.cache = {
        flags,
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
      return { ...this.config.flagDefaults };
    }

    // If cache is valid, return it
    if (this.isCacheValid() && this.cache) {
      return { ...this.cache.flags };
    }

    // Otherwise, refresh and return
    await this.refreshFlags();
    return this.cache ? { ...this.cache.flags } : { ...this.config.flagDefaults };
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
    const flags = await this.getFlags();
    const value = flags[key];

    if (value !== undefined) {
      return resolveEvaluatedDefinition(value, normalizeEntityContext(entity, kind));
    }

    // Check flagDefaults first, then use provided defaultValue
    return this.config.flagDefaults[key] ?? defaultValue;
  }

  /**
   * Evaluate a feature gate with multiple flags
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

    const flags = await this.getFlags();
    const entityContext = normalizeEntityContext(entity, kind);

    return evaluateEvaluatedGate(flags, keys, requirement, negate, entityContext);
  }

  registerContext<T>(
    kind: string,
    mapper: (entity: T) => import('@ops-ai/toggly-hooks-types').TogglyEntityContext,
  ): void {
    registerEntityContext(kind, mapper);
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
