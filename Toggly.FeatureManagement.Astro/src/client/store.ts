/**
 * Toggly Client-Side Store using Nanostores
 * 
 * Provides reactive state management for feature flags on the client side.
 * This module includes its own embedded Toggly client implementation.
 */

import { atom, computed, type ReadableAtom } from 'nanostores';
import type { TogglyConfig, Flags, VariantResult, EvaluatedVariantDef } from '../types/index.js';
import type { Hook } from '@ops-ai/toggly-hooks-types';
import {
  applyLocalGate,
  buildFlagGateIndex,
  type FlagGateIndex,
  type LocalGate,
} from '@ops-ai/toggly-local-gates';
import { HookExecutor } from './hooks.js';
import { parseVariantDefsPayload, variantDefsToFlags } from '../variant-helpers.js';
import { buildDefinitionFetchHeaders } from '../sdk-identity.js';

/**
 * Atom containing all feature flags
 */
export const $flags = atom<Flags>({});

/**
 * Atom containing evaluated variant definitions (empty when enableVariants is false)
 */
export const $variants = atom<Record<string, EvaluatedVariantDef>>({});

/**
 * Atom indicating if flags are loaded and ready
 */
export const $isReady = atom<boolean>(false);

/**
 * Atom containing any error that occurred during initialization
 */
export const $error = atom<Error | null>(null);

/**
 * Bumped when device-local gates change so computed atoms re-evaluate.
 */
export const $localGatesRevision = atom(0);

/**
 * Internal client instance storage
 */
let clientInstance: TogglyClientInstance | null = null;

/**
 * Internal client implementation
 */
class TogglyClientInstance {
  private config: TogglyConfig;
  private cache: Flags | null = null;
  private variantCache: Record<string, EvaluatedVariantDef> | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;
  public hookExecutor = new HookExecutor();
  private localGates: LocalGate[] = [];
  private localGateIndex: FlagGateIndex = new Map();
  private lastError: Error | null = null;

  constructor(config: TogglyConfig) {
    this.config = {
      baseURI: 'https://definitions.toggly.io',
      verifySignatures: false,
      environment: 'Production',
      flagDefaults: {},
      featureFlagsRefreshInterval: 3 * 60 * 1000,
      isDebug: false,
      connectTimeout: 5 * 1000,
      enableVariants: false,
      hooks: [],
      ...config,
    };
    
    // Register initial hooks
    if (this.config.hooks) {
      this.config.hooks.forEach(hook => this.hookExecutor.addHook(hook));
    }

    if (this.config.localGates) {
      this.setLocalGates(this.config.localGates);
    }
  }

  setLocalGates(gates: LocalGate[]): void {
    this.localGates = [...gates];
    this.localGateIndex = buildFlagGateIndex(this.localGates);
  }

  getEffectiveFlag(flagKey: string, remote: boolean): boolean {
    return applyLocalGate(remote, flagKey, this.localGates, this.localGateIndex);
  }

  notifyLocalGatesChanged(): void {
    $localGatesRevision.set($localGatesRevision.get() + 1);
  }

  private getApiUrl(): string {
    const { baseURI, appKey, environment, identity, enableVariants } = this.config;

    if (!appKey) {
      return '';
    }

    const baseUrl = baseURI!.replace(/\/$/, '');
    const path = enableVariants
      ? `/evaluated-variants-signed/${appKey}/${environment}`
      : `/evaluated-signed/${appKey}/${environment}`;
    let url = `${baseUrl}${path}`;

    if (identity) {
      if (enableVariants) {
        url += `?${new URLSearchParams({ userId: identity }).toString()}`;
      } else {
        url += `?u=${encodeURIComponent(identity)}`;
      }
    }

    return url;
  }

  async fetchFlags(): Promise<{ flags: Flags; variantDefs: Record<string, EvaluatedVariantDef> | null }> {
    const url = this.getApiUrl();
    const enableVariants = this.config.enableVariants === true;

    if (!url || !this.config.appKey) {
      if (this.config.isDebug) {
        console.log('[Toggly Client] Using flag defaults (no appKey):', this.config.flagDefaults);
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
        throw new Error(`Failed to fetch flags: ${response.status} ${response.statusText}`);
      }

      const payload = await response.json();
      let flags: Flags;
      let variantDefs: Record<string, EvaluatedVariantDef> | null;

      if (enableVariants) {
        variantDefs = parseVariantDefsPayload(payload);
        flags = variantDefsToFlags(variantDefs);
      } else {
        const asRecord = payload as Record<string, unknown>;
        flags = (
          'defs' in asRecord ? (asRecord.defs as Flags) : (payload as Flags)
        ) as Flags;
        variantDefs = null;
      }

      if (this.config.isDebug) {
        console.log('[Toggly Client] Fetched flags:', flags);
        if (enableVariants && variantDefs) {
          console.log('[Toggly Client] Fetched variant defs:', variantDefs);
        }
      }

      this.lastError = null;
      return { flags, variantDefs };
    } catch (error) {
      const fetchError = error instanceof Error ? error : new Error(String(error));
      this.lastError = fetchError;
      this.config.onError?.('Error fetching feature flags', error);
      $error.set(fetchError);

      if (this.config.isDebug) {
        console.error('[Toggly Client] Error fetching flags:', error);
      }

      // Fall back to cached flags or defaults
      if (this.cache) {
        if (this.config.isDebug) {
          console.log('[Toggly Client] Using cached flags');
        }
        return {
          flags: { ...this.cache },
          variantDefs: this.variantCache,
        };
      }

      if (this.config.isDebug) {
        console.log('[Toggly Client] Using flag defaults');
      }

      return {
        flags: { ...this.config.flagDefaults! },
        variantDefs: enableVariants ? {} : null,
      };
    }
  }

  async init(): Promise<void> {
    try {
      const { flags, variantDefs } = await this.fetchFlags();
      this.cache = flags;
      this.variantCache = variantDefs;
      $flags.set(flags);
      $variants.set(variantDefs ?? {});
      $isReady.set(true);
      $error.set(this.lastError);
      
      // Trigger afterRefresh hooks
      await this.hookExecutor.executeAfterRefresh(flags);

      // Start refresh interval if configured
      if (
        this.config.featureFlagsRefreshInterval &&
        this.config.featureFlagsRefreshInterval > 0
      ) {
        this.startRefreshInterval();
      }
    } catch (error) {
      $error.set(error as Error);
      $isReady.set(true); // Still mark as ready even on error
      console.error('[Toggly Client] Initialization error:', error);
    }
  }

  async refresh(): Promise<void> {
    try {
      const { flags, variantDefs } = await this.fetchFlags();
      this.cache = flags;
      this.variantCache = variantDefs;
      $flags.set(flags);
      $variants.set(variantDefs ?? {});
      $error.set(this.lastError);
      
      // Trigger afterRefresh hooks
      await this.hookExecutor.executeAfterRefresh(flags);

      if (this.config.isDebug) {
        console.log('[Toggly Client] Flags refreshed');
      }
    } catch (error) {
      console.error('[Toggly Client] Refresh error:', error);
    }
  }

  private startRefreshInterval(): void {
    if (this.refreshInterval) {
      return;
    }

    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, this.config.featureFlagsRefreshInterval!);

    if (this.config.isDebug) {
      console.log(
        `[Toggly Client] Started refresh interval: ${this.config.featureFlagsRefreshInterval}ms`
      );
    }
  }

  stopRefreshInterval(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;

      if (this.config.isDebug) {
        console.log('[Toggly Client] Stopped refresh interval');
      }
    }
  }

  setIdentity(identity: string): void {
    this.config.identity = identity;
    this.refresh(); // Refresh with new identity
  }

  clearIdentity(): void {
    this.config.identity = undefined;
    this.refresh(); // Refresh without identity
  }

  resolveVariant(featureKey: string): VariantResult | null {
    if (!this.config.enableVariants) {
      return null;
    }
    const defs = this.variantCache;
    if (!defs) {
      return null;
    }
    const entry = defs[featureKey];
    if (!entry?.variant) {
      return null;
    }
    if (!this.getEffectiveFlag(featureKey, entry.enabled === true)) {
      return null;
    }
    return {
      name: entry.variant,
      configurationValue: entry.configurationValue,
    };
  }
}

/**
 * Initialize Toggly client with configuration
 * 
 * @param config - Toggly configuration
 */
export async function initTogglyClient(config: TogglyConfig): Promise<void> {
  if (clientInstance) {
    console.warn('[Toggly Client] Client already initialized');
    return;
  }

  clientInstance = new TogglyClientInstance(config);
  await clientInstance.init();
}

/**
 * Manually refresh feature flags
 */
export async function refreshFlags(): Promise<void> {
  if (!clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return;
  }

  await clientInstance.refresh();
}

/**
 * Set user identity for targeting
 * 
 * @param identity - User identifier
 */
export function setIdentity(identity: string): void {
  if (!clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return;
  }

  clientInstance.setIdentity(identity);
}

/**
 * Clear user identity
 */
export function clearIdentity(): void {
  if (!clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return;
  }

  clientInstance.clearIdentity();
}

/**
 * Stop automatic refresh interval
 */
export function stopRefreshInterval(): void {
  if (clientInstance) {
    clientInstance.stopRefreshInterval();
  }
}

/**
 * Register device-local gates (read-time AND on worker booleans).
 */
export function setLocalGates(gates: LocalGate[]): void {
  if (!clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return;
  }
  clientInstance.setLocalGates(gates);
}

/**
 * Notify UI that local gate state changed (no network fetch).
 */
export function notifyLocalGatesChanged(): void {
  if (!clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return;
  }
  clientInstance.notifyLocalGatesChanged();
}

/**
 * Reset the client instance (for testing purposes)
 * @internal
 */
export function __resetClient(): void {
  if (clientInstance) {
    clientInstance.stopRefreshInterval();
  }
  clientInstance = null;
  $flags.set({});
  $variants.set({});
  $isReady.set(false);
  $error.set(null);
}

/**
 * Current variant assignment for a feature (requires enableVariants in config).
 */
export function getVariant(featureKey: string): VariantResult | null {
  if (!clientInstance) {
    return null;
  }
  return clientInstance.resolveVariant(featureKey);
}

/**
 * Configuration payload for the assigned variant, if any.
 */
export function getVariantValue(featureKey: string): unknown | null {
  const variant = getVariant(featureKey);
  return variant?.configurationValue ?? null;
}

/**
 * Create a computed atom for a specific feature flag
 * 
 * @param key - Feature flag key
 * @param defaultValue - Default value if flag not found
 * @returns Readable atom with the flag value
 */
export function $flag(key: string, defaultValue: boolean = false): ReadableAtom<boolean> {
  return computed([$flags, $localGatesRevision], (flags) => {
    const remote = flags[key] ?? defaultValue;
    if (!clientInstance) {
      return remote;
    }
    return clientInstance.getEffectiveFlag(key, remote === true);
  });
}

/**
 * Create a computed atom that evaluates multiple feature flags
 * 
 * @param keys - Array of feature flag keys
 * @param requirement - 'all' or 'any'
 * @param negate - Whether to negate the result
 * @returns Readable atom with the evaluation result
 */
export function $gate(
  keys: string[],
  requirement: 'all' | 'any' = 'all',
  negate: boolean = false
): ReadableAtom<boolean> {
  return computed([$flags, $localGatesRevision], (flags) => {
    if (keys.length === 0) {
      return !negate;
    }

    let isEnabled: boolean;

    if (requirement === 'any') {
      isEnabled = keys.some((key) => {
        const remote = flags[key] === true;
        return clientInstance
          ? clientInstance.getEffectiveFlag(key, remote)
          : remote;
      });
    } else {
      isEnabled = keys.every((key) => {
        const remote = flags[key] === true;
        return clientInstance
          ? clientInstance.getEffectiveFlag(key, remote)
          : remote;
      });
    }

    return negate ? !isEnabled : isEnabled;
  });
}

/**
 * Reactive variant assignment for a feature (null when disabled, missing, or no variant name).
 */
export function $variant(featureKey: string): ReadableAtom<VariantResult | null> {
  return computed([$variants, $localGatesRevision], () => {
    if (!clientInstance) {
      return null;
    }
    return clientInstance.resolveVariant(featureKey);
  });
}

/**
 * Add a hook dynamically
 */
export function addHook(hook: Hook): void {
  if (!clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return;
  }
  clientInstance.hookExecutor.addHook(hook);
}

/**
 * Remove a hook by name
 * @returns true if hook was found and removed, false otherwise
 */
export function removeHook(name: string): boolean {
  if (!clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return false;
  }
  return clientInstance.hookExecutor.removeHook(name);
}

