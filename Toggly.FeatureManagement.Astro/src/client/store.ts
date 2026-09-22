/**
 * Toggly Client-Side Store using Nanostores
 * 
 * Provides reactive state management for feature flags on the client side.
 * This module includes its own embedded Toggly client implementation.
 */

import { createTelemetryReporter, type TelemetryReporter } from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';
import { atom, computed, type ReadableAtom } from 'nanostores';
import type { TogglyConfig, Flags, VariantResult, EvaluatedVariantDef } from '../types/index.js';
import {
  appendEvaluationContext,
  isEntityGate,
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
  planFlagsUpdatedRefresh,
  applyFlagsUpdatedPlan,
  shouldFetchOnSync,
  REFRESH_DEBOUNCE_MS,
  type WsSyncMessage,
} from './ws-sync.js';

const FALLBACK_REFRESH_INTERVAL_MS = 20 * 60 * 1000;

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
  private disposed = false;
  private generation = 0;
  private reporter: TelemetryReporter | undefined;
  private detachTelemetry: (() => void) | undefined;
  private requests = new Map<AbortController, ReturnType<typeof setTimeout>>();
  private cache: Flags | null = null;
  private hasDefinitionsBody = false;
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
      groups: config.groups ? [...config.groups] : undefined,
      claims: config.claims ? {...config.claims} : undefined,
    };

    if (typeof window !== 'undefined' && typeof document !== 'undefined' &&
      typeof window.addEventListener === 'function' && typeof document.addEventListener === 'function' &&
      this.config.appKey?.trim() && this.config.enableTelemetry !== false &&
      (this.config.enableUsageTracking !== false || this.config.enableMetrics !== false)) {
      this.reporter = createTelemetryReporter({appKey: this.config.appKey, environment: this.config.environment,
        instanceId: this.config.instanceId, identity: this.config.identity,
        metricsBaseUrl: this.config.metricsBaseUrl, telemetryFlushIntervalMs: this.config.telemetryFlushIntervalMs,
        fetch: this.config.telemetryFetch, onDiagnostic: code => {try {this.config.onError?.(code);} catch { /* Host diagnostics cannot affect evaluation. */ }}});
      this.detachTelemetry = attachBrowserLifecycle(this.reporter);
    }
    this.removeLegacyRevision();
    
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

  /** Snapshot attribution, assigned variants and gates before any host callback. */
  captureEvaluation(record = true) {
    const variants = Object.fromEntries(Object.entries(this.variantCache ?? {}).map(([key, value]) => [key, value.variant]));
    const gates = this.localGates.map(gate => ({...gate, flagKeys:[...gate.flagKeys]}));
    const index = this.localGateIndex;
    const check = record && this.cache !== null && !this.disposed && this.config.enableUsageTracking !== false
      ? this.reporter?.captureCheck() : undefined;
    return (key: string, definition: EvaluatedDefinitionValue | undefined, defaultValue = false, entity?: TogglyEntityContext | null): boolean => {
      const remote = resolveEvaluatedDefinition(definition, entity, defaultValue);
      const result = applyLocalGate(remote, key, gates, index);
      check?.(key, result ? variants[key] || 'enabled' : 'disabled');
      return result;
    };
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

  // Astro has no persisted definitions body. A disk validator cannot be paired
  // after a cold start, so remove the old orphan and retain validators in memory.
  private removeLegacyRevision(): void {
    try {
      if (this.config.appKey && typeof localStorage !== 'undefined') {
        localStorage.removeItem(`toggly:revision:${this.config.appKey}:${this.config.environment}`);
      }
    } catch { /* Storage denial must not affect initialization. */ }
  }

  private cacheDefinitionsRevision(revision: string | null | undefined): void {
    if (revision && this.hasDefinitionsBody) this.definitionsRevision = revision.replace(/^"+|"+$/g, '');
  }

  private clearDefinitionsRevision(): void {
    this.definitionsRevision = null;
  }

  private getApiUrl(): string {
    const { baseURI, appKey, environment, identity, instanceId, groups, claims, enableVariants } = this.config;

    if (!appKey) {
      return '';
    }

    const url = new URL(baseURI!);
    const path = enableVariants
      ? `/evaluated-variants-signed/${appKey}/${environment}`
      : `/evaluated-signed/${appKey}/${environment}`;
    url.pathname = `${url.pathname.replace(/\/$/, '')}${path}`;

    // Attribution belongs to the current context, never to inherited URL defaults.
    url.searchParams.delete('i');
    if (instanceId?.trim()) {
      for (const key of [...url.searchParams.keys()]) {
        if (key === 'u' || key === 'userId' || key === 'g' || key.startsWith('claim.')) {
          url.searchParams.delete(key);
        }
      }
      url.searchParams.set('i', instanceId.trim());
    } else appendEvaluationContext(
      url,
      { identity, groups, claims },
      enableVariants ? 'variants' : 'evaluated',
    );

    return url.toString();
  }

  async fetchFlags(): Promise<{ flags: Flags; variantDefs: Record<string, EvaluatedVariantDef> | null }> {
    const expected = this.generation;
    if (this.disposed) return {flags: {}, variantDefs: null};
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.connectTimeout);
    this.requests.set(controller, timeoutId);
    try {

      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (this.hasDefinitionsBody && this.definitionsRevision) {
        headers['If-None-Match'] = this.definitionsRevision;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: buildDefinitionFetchHeaders(headers),
        cache: 'no-store',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (this.disposed || expected !== this.generation) return {flags: {}, variantDefs: null};

      const responseRevision = extractDefinitionsRevision(response);

      if (response.status === 304) {
        if (this.hasDefinitionsBody && this.cache) {
          this.cacheDefinitionsRevision(responseRevision);
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
        // Public JWKS does not need SDK definition-request headers.
      });
      if (this.disposed || expected !== this.generation) return {flags: {}, variantDefs: null};
      let flags: Flags;
      let variantDefs: Record<string, EvaluatedVariantDef> | null;

      if (enableVariants) {
        const body = unwrapDefsPayload(payload);
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.values(body).some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry) ||
            typeof entry.enabled !== 'boolean' || (entry.variant !== undefined && typeof entry.variant !== 'string'))) {
          throw new Error('Invalid variant definitions body');
        }
        variantDefs = parseVariantDefsPayload({defs: body});
        flags = variantDefsToFlags(variantDefs);
      } else {
        const body = unwrapDefsPayload(payload);
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.values(body).some(entry => typeof entry !== 'boolean' && !isEntityGate(entry))) throw new Error('Invalid definitions body');
        flags = body as Flags;
        variantDefs = null;
      }

      if (this.config.isDebug) {
        console.log('[Toggly Client] Fetched flags:', flags);
        if (enableVariants && variantDefs) {
          console.log('[Toggly Client] Fetched variant defs:', variantDefs);
        }
      }

      // Commit body before its validator; no callback may observe a mismatched pair.
      this.cache = flags;
      this.variantCache = variantDefs;
      this.hasDefinitionsBody = true;
      this.definitionsRevision = null;
      this.cacheDefinitionsRevision(responseRevision);
      this.lastError = null;
      return { flags, variantDefs };
    } catch (error) {
      if (this.disposed || expected !== this.generation) return {flags: {}, variantDefs: null};
      const fetchError = error instanceof Error ? error : new Error(String(error));
      this.lastError = fetchError;
      try {this.config.onError?.('Error fetching feature flags', error);} catch { /* Diagnostics cannot replace evaluation. */ }
      if (this.disposed || expected !== this.generation) return {flags: {}, variantDefs: null};
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
    } finally {
      clearTimeout(timeoutId);
      this.requests.delete(controller);
    }
  }

  async init(): Promise<void> {
    const expected = ++this.generation;
    try {
      const { flags, variantDefs } = await this.fetchFlags();
      if (this.disposed || expected !== this.generation) return;
      this.cache = flags;
      this.variantCache = variantDefs;
      $flags.set(flags);
      if (this.disposed || expected !== this.generation) return;
      $variants.set(variantDefs ?? {});
      if (this.disposed || expected !== this.generation) return;
      $isReady.set(true);
      if (this.disposed || expected !== this.generation) return;
      $error.set(this.lastError);
      if (this.disposed || expected !== this.generation) return;
      
      // Trigger afterRefresh hooks
      await this.hookExecutor.executeAfterRefresh(toBooleanDefinitions(flags),
        () => !this.disposed && expected === this.generation);

      if (this.disposed || expected !== this.generation) return;
      this.startWebSocket();

      // Start refresh interval if configured
      if (
        this.config.featureFlagsRefreshInterval &&
        this.config.featureFlagsRefreshInterval > 0
      ) {
        this.startRefreshInterval();
      }
    } catch (error) {
      if (this.disposed || expected !== this.generation) return;
      $error.set(error as Error);
      $isReady.set(true); // Still mark as ready even on error
      console.error('[Toggly Client] Initialization error:', error);
    }
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    const expected = ++this.generation;
    try {
      const { flags, variantDefs } = await this.fetchFlags();
      if (this.disposed || expected !== this.generation) return;
      this.cache = flags;
      this.variantCache = variantDefs;
      $flags.set(flags);
      if (this.disposed || expected !== this.generation) return;
      $variants.set(variantDefs ?? {});
      if (this.disposed || expected !== this.generation) return;
      $error.set(this.lastError);
      if (this.disposed || expected !== this.generation) return;
      
      // Trigger afterRefresh hooks
      await this.hookExecutor.executeAfterRefresh(toBooleanDefinitions(flags),
        () => !this.disposed && expected === this.generation);

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
    if (message.etag === this.definitionsRevision) {
      this.cacheDefinitionsRevision(message.etag);
    }
  }

  private handleWsUpdateMessage(message: WsSyncMessage): void {
    applyFlagsUpdatedPlan(
      planFlagsUpdatedRefresh(message, this.definitionsRevision),
      message,
      {
        refreshJwks: () => this.scheduleDebouncedRefresh(true),
        refreshPinned: () => this.scheduleDebouncedRefresh(true),
        cacheEtagIfPresent: (etag) => {if (etag === this.definitionsRevision) this.cacheDefinitionsRevision(etag);},
      },
    );
  }

  startWebSocket(): void {
    if (this.disposed || typeof window === 'undefined') return;
    if (!this.config.appKey) {
      return;
    }

    if (this.config.enableLiveUpdates === false) {
      return;
    }

    if (typeof WebSocket === 'undefined') {
      return;
    }

    // Preserve a pending debounced refresh across reconnect so updates
    // received just before disconnect are not dropped.
    this.stopWebSocket({ preserveDebounce: true });

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

  stopWebSocket(options?: { preserveDebounce?: boolean }): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }

    if (!options?.preserveDebounce && this.refreshDebounceTimer) {
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
    if (this.disposed || typeof window === 'undefined') return;
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

  setIdentity(identity: string | undefined): void {
    void this.updateContext({...this.config, identity}, true);
  }

  clearIdentity(): void {
    this.setIdentity(undefined);
  }

  async updateContext(config: TogglyConfig, refreshUnchanged = false): Promise<void> {
    const next = {...this.config, identity: config.identity, instanceId: config.instanceId,
      groups: config.groups ? [...config.groups] : undefined,
      claims: config.claims ? {...config.claims} : undefined, enableVariants: config.enableVariants ?? false};
    const oldUrl = this.getApiUrl();
    const oldIdentity = this.config.identity;
    this.config = next;
    this.reporter?.setContext({identity: next.identity, instanceId: next.instanceId});
    if (oldUrl === this.getApiUrl()) {
      if (refreshUnchanged) {await this.refresh(); return;}
      if (oldIdentity === next.identity) console.warn('[Toggly Client] Client already initialized');
      return;
    }
    const expected = ++this.generation;
    for (const [controller, timer] of this.requests) {clearTimeout(timer); controller.abort();}
    this.requests.clear();
    this.stopWebSocket();
    this.cache = null;
    this.hasDefinitionsBody = false;
    this.variantCache = null;
    this.clearDefinitionsRevision();
    $flags.set({...this.config.flagDefaults});
    if (this.disposed || expected !== this.generation) return;
    $variants.set({});
    if (this.disposed || expected !== this.generation) return;
    $error.set(null);
    if (this.disposed || expected !== this.generation) return;
    await this.init();
  }

  matchesOwner(config: TogglyConfig): boolean {
    return this.config.appKey === config.appKey && this.config.environment === (config.environment ?? 'Production') &&
      this.config.baseURI === (config.baseURI ?? 'https://definitions.toggly.io') &&
      this.config.telemetryFetch === config.telemetryFetch &&
      this.config.verifySignatures === (config.verifySignatures ?? false) &&
      (['enableTelemetry', 'enableUsageTracking', 'enableMetrics', 'metricsBaseUrl', 'telemetryFlushIntervalMs'] as const)
        .every(key => this.config[key] === config[key]);
  }

  recordUsage(key: string, variant = 'enabled'): void {
    if (!this.disposed && this.config.enableUsageTracking !== false) this.reporter?.recordUsage(key, variant);
  }
  recordView(key: string, variant = 'enabled'): void {
    if (!this.disposed && this.config.enableUsageTracking !== false) this.reporter?.recordView(key, variant);
  }
  incrementCounter(key: string, value = 1): void {
    if (!this.disposed && this.config.enableMetrics !== false) this.reporter?.incrementCounter(key, value);
  }
  setGauge(key: string, value: number): void {
    if (!this.disposed && this.config.enableMetrics !== false) this.reporter?.setGauge(key, value);
  }
  async flushTelemetry(): Promise<void> {await this.reporter?.flush();}
  dispose(flush = true): void {
    this.disposed = true; this.generation++;
    this.stopRefreshInterval();
    for (const [controller, timer] of this.requests) {clearTimeout(timer); controller.abort();}
    this.requests.clear();
    this.detachTelemetry?.(); this.reporter?.dispose({flush});
  }

  resolveVariant(featureKey: string, record = true): VariantResult | null {
    const entry = this.config.enableVariants ? this.variantCache?.[featureKey] : undefined;
    const variant = entry?.variant;
    const configurationValue = entry?.configurationValue;
    const enabled = this.captureEvaluation(record)(featureKey, entry ? entry.enabled === true : this.cache?.[featureKey]);
    if (!variant || !enabled) return null;
    return {name: variant, configurationValue};
  }
}

/**
 * Initialize Toggly client with configuration
 * 
 * @param config - Toggly configuration
 */
export async function initTogglyClient(config: TogglyConfig): Promise<void> {
  // Explicit Node initialization loads definitions; telemetry and background work stay browser-gated.
  if (clientInstance?.matchesOwner(config)) {
    await clientInstance.updateContext(config);
    return;
  }
  if (clientInstance) {
    clientInstance.dispose(false);
    clientInstance = null;
    $flags.set({}); $variants.set({}); $isReady.set(false); $error.set(null);
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
export function __resetClient(): void { destroyTogglyClient(); }

/** Release the shared browser owner; island unmount alone does not dispose it. */
export function destroyTogglyClient(): void {
  const previous = clientInstance;
  clientInstance = null;
  previous?.dispose();
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

/** Nanostores keeps unobserved atoms warm for one second; those projections
 * must not become UI checks after an island unsubscribes. Explicit get() only
 * counts if its dependencies cause a real recomputation. */
function evaluatedComputed<Input, Output>(source: ReadableAtom<Input>, evaluate: (value: Input, record: boolean) => Output): ReadableAtom<Output> {
  let reading = false;
  let listeners = 0;
  const result = computed([source, $localGatesRevision], value => evaluate(value, reading || listeners > 0));
  const get = result.get;
  result.get = () => {
    reading = true;
    try {return get();} finally {reading = false;}
  };
  const listen = result.listen;
  result.listen = listener => {
    listeners++;
    const unsubscribe = listen(listener);
    let active = true;
    return () => {if (active) {active = false; listeners--; unsubscribe();}};
  };
  return result;
}

/** Copy the supported entity gate's mutable rules before host callbacks run. */
function snapshotDefinition(definition: EvaluatedDefinitionValue | undefined): EvaluatedDefinitionValue | undefined {
  return isEntityGate(definition)
    ? { ...definition, rules: definition.rules.map(rule => ({ ...rule })) }
    : definition;
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
  return evaluatedComputed($flags, (flags, record) => {
    const definition = snapshotDefinition(flags[key]);
    const evaluate = clientInstance?.captureEvaluation(record);
    const entityContext = normalizeEntityContext(entity, kind);
    if (!evaluate) {
      return resolveEvaluatedDefinition(definition, entityContext, defaultValue);
    }
    return evaluate(key, definition, defaultValue, entityContext);
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
  return evaluatedComputed($flags, (flags, record) => {
    if (keys.length === 0) {
      return !negate;
    }

    const selectedKeys = [...keys];
    const definitions = Object.fromEntries(selectedKeys.map(key => [key, snapshotDefinition(flags[key])]));
    const effective = clientInstance?.captureEvaluation(record);
    const entityContext = normalizeEntityContext(entity, kind);
    const evaluate = (key: string) =>
      effective
        ? effective(key, definitions[key], false, entityContext)
        : resolveEvaluatedDefinition(definitions[key], entityContext);

    const isEnabled = requirement === 'any' ? selectedKeys.some(evaluate) : selectedKeys.every(evaluate);

    return negate ? !isEnabled : isEnabled;
  });
}

/**
 * Reactive variant assignment for a feature (null when disabled, missing, or no variant name).
 */
export function $variant(featureKey: string): ReadableAtom<VariantResult | null> {
  return evaluatedComputed($variants, (variants, record) => {
    if (!clientInstance) {
      const entry = variants[featureKey];
      return entry?.enabled && entry.variant ? {name: entry.variant, configurationValue: entry.configurationValue} : null;
    }
    return clientInstance.resolveVariant(featureKey, record);
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


/** Explicit browser events never evaluate flags. */
export function recordUsage(key: string, variant = 'enabled'): void {clientInstance?.recordUsage(key, variant);}
export function recordView(key: string, variant = 'enabled'): void {clientInstance?.recordView(key, variant);}
export function incrementCounter(key: string, value = 1): void {clientInstance?.incrementCounter(key, value);}
export function setGauge(key: string, value: number): void {clientInstance?.setGauge(key, value);}
export async function flushTelemetry(): Promise<void> {await clientInstance?.flushTelemetry();}
