/**
 * Toggly Client-Side Store using Nanostores
 * 
 * Provides reactive state management for feature flags on the client side.
 * This module includes its own embedded Toggly client implementation.
 */

import { atom, computed, type ReadableAtom } from 'nanostores';
import type { TogglyConfig, Flags } from '../types/index.js';
import type { Hook } from '@ops-ai/toggly-hooks-types';
import { HookExecutor } from './hooks.js';

/**
 * Atom containing all feature flags
 */
export const $flags = atom<Flags>({});

/**
 * Atom indicating if flags are loaded and ready
 */
export const $isReady = atom<boolean>(false);

/**
 * Atom containing any error that occurred during initialization
 */
export const $error = atom<Error | null>(null);

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
  private refreshInterval: NodeJS.Timeout | null = null;
  public hookExecutor = new HookExecutor();

  constructor(config: TogglyConfig) {
    this.config = {
      baseURI: 'https://client.toggly.io',
      environment: 'Production',
      flagDefaults: {},
      featureFlagsRefreshInterval: 3 * 60 * 1000,
      isDebug: false,
      connectTimeout: 5 * 1000,
      hooks: [],
      ...config,
    };
    
    // Register initial hooks
    if (this.config.hooks) {
      this.config.hooks.forEach(hook => this.hookExecutor.addHook(hook));
    }
  }

  private getApiUrl(): string {
    const { baseURI, appKey, environment, identity } = this.config;

    if (!appKey) {
      return '';
    }

    const baseUrl = baseURI!.replace(/\/$/, '');
    let url = `${baseUrl}/${appKey}-${environment}/defs`;

    if (identity) {
      url += `?u=${encodeURIComponent(identity)}`;
    }

    return url;
  }

  async fetchFlags(): Promise<Flags> {
    const url = this.getApiUrl();

    if (!url || !this.config.appKey) {
      if (this.config.isDebug) {
        console.log('[Toggly Client] Using flag defaults (no appKey):', this.config.flagDefaults);
      }
      return { ...this.config.flagDefaults! };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.connectTimeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        cache: 'no-store',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch flags: ${response.status} ${response.statusText}`);
      }

      const flags = (await response.json()) as Flags;

      if (this.config.isDebug) {
        console.log('[Toggly Client] Fetched flags:', flags);
      }

      return flags;
    } catch (error) {
      if (this.config.isDebug) {
        console.error('[Toggly Client] Error fetching flags:', error);
      }

      // Fall back to cached flags or defaults
      if (this.cache) {
        if (this.config.isDebug) {
          console.log('[Toggly Client] Using cached flags');
        }
        return { ...this.cache };
      }

      if (this.config.isDebug) {
        console.log('[Toggly Client] Using flag defaults');
      }

      return { ...this.config.flagDefaults! };
    }
  }

  async init(): Promise<void> {
    try {
      const flags = await this.fetchFlags();
      this.cache = flags;
      $flags.set(flags);
      $isReady.set(true);
      $error.set(null);
      
      // Trigger afterRefresh hooks
      this.hookExecutor.executeAfterRefresh(flags);

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
      const flags = await this.fetchFlags();
      this.cache = flags;
      $flags.set(flags);
      
      // Trigger afterRefresh hooks
      this.hookExecutor.executeAfterRefresh(flags);

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
 * Create a computed atom for a specific feature flag
 * 
 * @param key - Feature flag key
 * @param defaultValue - Default value if flag not found
 * @returns Readable atom with the flag value
 */
export function $flag(key: string, defaultValue: boolean = false): ReadableAtom<boolean> {
  return computed($flags, (flags) => flags[key] ?? defaultValue);
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
  return computed($flags, (flags) => {
    if (keys.length === 0) {
      return !negate;
    }

    let isEnabled: boolean;

    if (requirement === 'any') {
      isEnabled = keys.some((key) => flags[key] === true);
    } else {
      isEnabled = keys.every((key) => flags[key] === true);
    }

    return negate ? !isEnabled : isEnabled;
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

