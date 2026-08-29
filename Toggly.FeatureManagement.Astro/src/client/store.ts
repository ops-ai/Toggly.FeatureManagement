/**
 * Toggly Client-Side Store using Nanostores
 * 
 * Provides reactive state management for feature flags on the client side.
 * This module includes its own embedded Toggly client implementation.
 */

import { atom, computed, type ReadableAtom } from 'nanostores';
import type { TogglyConfig, Flags, VariantResult, EvaluatedVariantDef } from '../types/index.js';
import {
  appendEvaluationContext,
  normalizeEntityContext,
  registerContext as registerEntityContext,
  resolveEvaluatedDefinition,
  toBooleanDefinitions,
  type EvaluatedDefinitionValue,
  type Hook,
  type TogglyEntityContext,
} from '@ops-ai/toggly-hooks-types';
import {
  applyLocalGate,
  buildFlagGateIndex,
  type FlagGateIndex,
  type LocalGate,
} from '@ops-ai/toggly-local-gates';
import { HookExecutor } from './hooks.js';
import { parseVariantDefsPayload, variantDefsToFlags } from '../variant-helpers.js';
import { buildDefinitionFetchHeaders } from '../sdk-identity.js';
import {
  parseEvaluatedResponseBody,
  readResponseBody,
  unwrapDefsPayload,
} from '../signed-response.js';
import {
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  shouldFetchOnSync,
  REFRESH_DEBOUNCE_MS,
  type WsSyncMessage,
} from './ws-sync.js';

const FALLBACK_REFRESH_INTERVAL_MS = 20 * 60 * 1000;

function revisionCacheKey(appKey: string, environment: string): string {
  return `toggly:revision:${appKey}:${environment}`;
}

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
  private definitionsRevision: string | null = null;
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private wsReconnectAttempt = 0;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFallbackRefresh = 0;

  constructor(config: TogglyConfig) {
    this.config = {
      baseURI: 'https://definitions.toggly.io',
      verifySignatures: false,
      environment: 'Production',
      flagDefaults: {},
      featureFlagsRefreshInterval: 3 * 60 * 1000,
      enableLiveUpdates: true,
      isDebug: false,
      connectTimeout: 5 * 1000,
      enableVariants: false,
      hooks: [],
      ...config,
    };

    this.definitionsRevision = this.readCachedRevision();
    
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

  getEffectiveFlag(
    flagKey: string,
    definition?: EvaluatedDefinitionValue,
    defaultValue = false,
    entityContext?: TogglyEntityContext | null,
  ): boolean {
    const remote = resolveEvaluatedDefinition(definition, entityContext, defaultValue);
    return applyLocalGate(remote, flagKey, this.localGates, this.localGateIndex);
  }

  registerContext<T>(
    kind: string,
    mapper: (entity: T) => TogglyEntityContext,
  ): void {
    registerEntityContext(kind, mapper);
  }

  notifyLocalGatesChanged(): void {
    $localGatesRevision.set($localGatesRevision.get() + 1);
  }

  private readCachedRevision(): string | null {
    const appKey = this.config.appKey;
    if (!appKey) {
      return null;
    }
    try {
      if (typeof localStorage === 'undefined') {
        return null;
      }
      return localStorage.getItem(
        revisionCacheKey(appKey, this.config.environment ?? 'Production')
      );
    } catch {
      return null;
    }
  }

  private cacheDefinitionsRevision(revision: string | null | undefined): void {
    if (!revision) {
      return;
    }
    const cleaned = revision.replace(/^"+|"+$/g, '');
    this.definitionsRevision = cleaned;
    const appKey = this.config.appKey;
    if (!appKey) {
      return;
    }
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(
        revisionCacheKey(appKey, this.config.environment ?? 'Production'),
        cleaned
      );
    } catch {
      // Ignore storage failures (private mode, SSR, etc.)
    }
  }

  private clearDefinitionsRevision(): void {
    this.definitionsRevision = null;
    const appKey = this.config.appKey;
    if (!appKey) {
      return;
    }
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.removeItem(
        revisionCacheKey(appKey, this.config.environment ?? 'Production')
      );
    } catch {
      // Ignore storage failures
    }
  }

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

      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (this.definitionsRevision) {
        headers['If-None-Match'] = this.definitionsRevision;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: buildDefinitionFetchHeaders(headers),
        cache: 'no-store',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseRevision = extractDefinitionsRevision(response);
      if (responseRevision) {
        this.cacheDefinitionsRevision(responseRevision);
      }

      if (response.status === 304) {
        if (this.cache) {
          this.lastError = null;
          return {
            flags: { ...this.cache },
            variantDefs: this.variantCache,
          };
        }
        // No in-memory cache — fall through as error-like and use defaults below
        throw new Error('304 Not Modified but no cached flags');
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch flags: ${response.status} ${response.statusText}`);
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
      let variantDefs: Record<string, EvaluatedVariantDef> | null;

      if (enableVariants) {
        variantDefs = parseVariantDefsPayload(
          this.config.verifySignatures ? { defs: payload } : payload
        );
        flags = variantDefsToFlags(variantDefs);
      } else {
        flags = unwrapDefsPayload(payload) as Flags;
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
      await this.hookExecutor.executeAfterRefresh(toBooleanDefinitions(flags));

      this.startWebSocket();

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
      await this.hookExecutor.executeAfterRefresh(toBooleanDefinitions(flags));

      if (this.config.isDebug) {
        console.log('[Toggly Client] Flags refreshed');
      }
    } catch (error) {
      console.error('[Toggly Client] Refresh error:', error);
    }
  }

  private scheduleDebouncedRefresh(forceRevisionReset = false): void {
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    this.refreshDebounceTimer = setTimeout(() => {
      this.refreshDebounceTimer = null;
      if (forceRevisionReset) {
        this.clearDefinitionsRevision();
      }
      this.refresh().catch(() => {
        // Error already logged in refresh()
      });
    }, REFRESH_DEBOUNCE_MS);
  }

  private handleWsSyncMessage(message: WsSyncMessage): void {
    const previousRevision = this.definitionsRevision;
    if (shouldFetchOnSync(message, previousRevision)) {
      // Do not cache message.etag before refresh — that would make the
      // follow-up GET send If-None-Match for the new revision and 304 with
      // stale in-memory defs.
      this.scheduleDebouncedRefresh();
      return;
    }
    if (message.etag) {
      this.cacheDefinitionsRevision(message.etag);
    }
  }

  private handleWsUpdateMessage(message: WsSyncMessage): void {
    if (shouldFetchOnSigningKeyUpdated(message)) {
      this.scheduleDebouncedRefresh(true);
      return;
    }
    const previousRevision = this.definitionsRevision;
    if (shouldFetchOnFlagsUpdated(message, previousRevision)) {
      // Clear revision so the GET is unconditional. Caching the WS etag
      // before fetch caused 304 responses and left flags stale.
      this.scheduleDebouncedRefresh(true);
      return;
    }
    if (message.etag) {
      this.cacheDefinitionsRevision(message.etag);
    }
  }

  startWebSocket(): void {
    if (!this.config.appKey) {
      return;
    }

    if (this.config.enableLiveUpdates === false) {
      return;
    }

    if (typeof WebSocket === 'undefined') {
      return;
    }

    this.stopWebSocket();

    const wsUrl = buildWebSocketUrl(
      this.config.baseURI!,
      this.config.appKey,
      this.definitionsRevision
    );

    if (this.config.isDebug) {
      console.log(`[Toggly Client] WebSocket connecting to ${wsUrl}`);
    }

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      this.wsConnected = true;
      this.wsReconnectAttempt = 0;
      this.lastFallbackRefresh = Date.now();
      if (this.config.isDebug) {
        console.log('[Toggly Client] WebSocket connected');
      }
    };

    ws.onmessage = (event) => {
      const data = event.data;

      if (typeof data === 'string') {
        if (data === 'update' || data === 'flags-updated') {
          if (this.config.isDebug) {
            console.log(`[Toggly Client] WebSocket received text: ${data}`);
          }
          this.scheduleDebouncedRefresh();
          return;
        }

        try {
          const message = JSON.parse(data) as WsSyncMessage;
          if (message.type === 'ping') {
            return;
          }
          if (message.type === 'sync') {
            if (this.config.isDebug) {
              console.log('[Toggly Client] WebSocket received sync');
            }
            this.handleWsSyncMessage(message);
            return;
          }
          if (
            message.type === 'flags-updated' ||
            message.type === 'update' ||
            message.type === 'signing-key-updated'
          ) {
            if (this.config.isDebug) {
              console.log(`[Toggly Client] WebSocket received: ${message.type}`);
            }
            this.handleWsUpdateMessage(message);
          }
        } catch {
          if (this.config.isDebug) {
            console.log(`[Toggly Client] WebSocket received unrecognized message: ${data}`);
          }
        }
      }
    };

    ws.onclose = () => {
      this.wsConnected = false;
      this.ws = null;
      const delay = getNextReconnectDelayMs(this.wsReconnectAttempt);
      this.wsReconnectAttempt += 1;
      if (this.config.isDebug) {
        console.log(`[Toggly Client] WebSocket closed, reconnecting in ${delay}ms`);
      }

      this.wsReconnectTimer = setTimeout(() => {
        this.startWebSocket();
      }, delay);
    };

    ws.onerror = (error) => {
      console.error('[Toggly Client] WebSocket error:', error);
    };

    this.ws = ws;
  }

  stopWebSocket(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }

    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
      this.refreshDebounceTimer = null;
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    this.wsConnected = false;
  }

  private startRefreshInterval(): void {
    if (this.refreshInterval) {
      return;
    }

    this.refreshInterval = setInterval(() => {
      if (
        this.wsConnected &&
        Date.now() - this.lastFallbackRefresh < FALLBACK_REFRESH_INTERVAL_MS
      ) {
        if (this.config.isDebug) {
          console.log('[Toggly Client] Skipping interval refresh, WebSocket is connected');
        }
        return;
      }

      this.lastFallbackRefresh = Date.now();
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
    this.stopWebSocket();
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
 * Stop automatic refresh interval and WebSocket live updates
 */
export function stopRefreshInterval(): void {
  if (clientInstance) {
    clientInstance.stopRefreshInterval();
  }
}

/**
 * Stop WebSocket live updates (keeps poll interval if running)
 */
export function stopWebSocket(): void {
  if (clientInstance) {
    clientInstance.stopWebSocket();
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
  $localGatesRevision.set(0);
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
 * @param entity - Entity the flag is evaluated against, or a mappable domain object
 * @param kind - Registered context kind, required when entity is a domain object
 * @returns Readable atom with the flag value
 */
export function $flag(
  key: string,
  defaultValue: boolean = false,
  entity?: TogglyEntityContext | Record<string, unknown> | null,
  kind?: string,
): ReadableAtom<boolean> {
  return computed([$flags, $localGatesRevision], (flags) => {
    const entityContext = normalizeEntityContext(entity, kind);
    if (!clientInstance) {
      return resolveEvaluatedDefinition(flags[key], entityContext, defaultValue);
    }
    return clientInstance.getEffectiveFlag(key, flags[key], defaultValue, entityContext);
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
  negate: boolean = false,
  entity?: TogglyEntityContext | Record<string, unknown> | null,
  kind?: string,
): ReadableAtom<boolean> {
  return computed([$flags, $localGatesRevision], (flags) => {
    if (keys.length === 0) {
      return !negate;
    }

    const entityContext = normalizeEntityContext(entity, kind);
    const evaluate = (key: string) =>
      clientInstance
        ? clientInstance.getEffectiveFlag(key, flags[key], false, entityContext)
        : resolveEvaluatedDefinition(flags[key], entityContext);

    const isEnabled = requirement === 'any' ? keys.some(evaluate) : keys.every(evaluate);

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

