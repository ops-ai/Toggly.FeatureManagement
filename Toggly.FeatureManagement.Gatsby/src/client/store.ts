/**
 * Toggly Client-Side Store using Nanostores
 *
 * Provides reactive state management for feature flags on the client side.
 * This module includes its own embedded Toggly client implementation.
 */

import { atom, computed } from 'nanostores';
import {
  createTelemetryReporter,
  type TelemetryReporter,
} from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';
import type {
  TogglyPluginOptions,
  Flags,
  GateRequirement,
  TogglyReadableAtom,
  TogglyWritableAtom,
} from '../types/index.js';
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
  REFRESH_DEBOUNCE_MS,
  appendDefinitionsRevisionParam,
  applyFlagsUpdatedPlan,
  planFlagsUpdatedRefresh,
  shouldFetchOnSync,
  type WsSyncMessage,
} from '../utils/ws-sync.js';

type ClientStoreState = {
  flags: TogglyWritableAtom<Flags>;
  isReady: TogglyWritableAtom<boolean>;
  error: TogglyWritableAtom<Error | null>;
  localGatesRevision: TogglyWritableAtom<number>;
  clientInstance: TogglyClientInstance | null;
  clientInitPromise: Promise<void> | null;
};

// Gatsby can load the browser plugin's CommonJS entry alongside application
// ESM entries. Keep the browser owner and atoms in one realm-wide registry so
// those compiled entry points cannot create independent client snapshots.
const CLIENT_STORE_KEY = Symbol.for('@ops-ai/gatsby-feature-flags-toggly/client-store-v1');
const clientStoreGlobal = globalThis as Record<PropertyKey, unknown>;
const createClientStore = (): ClientStoreState => ({
  flags: atom<Flags>({}),
  isReady: atom<boolean>(false),
  error: atom<Error | null>(null),
  localGatesRevision: atom(0),
  clientInstance: null,
  clientInitPromise: null,
});
const browserRealm = typeof window !== 'undefined' && typeof document !== 'undefined';
const clientStore = browserRealm
  ? (clientStoreGlobal[CLIENT_STORE_KEY] as ClientStoreState | undefined) ?? createClientStore()
  : createClientStore();
if (browserRealm) clientStoreGlobal[CLIENT_STORE_KEY] = clientStore;

/** Atom containing all feature flags. */
export const $flags = clientStore.flags;

/** Atom indicating if flags are loaded and ready. */
export const $isReady = clientStore.isReady;

/** Atom containing any error that occurred during initialization. */
export const $error = clientStore.error;

/** Bumped when device-local gates change so computed atoms re-evaluate. */
export const $localGatesRevision = clientStore.localGatesRevision;

const FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000;

function definitionsRevisionCacheKey(appKey: string, environment: string): string {
  return `toggly:revision:${appKey}:${environment}`;
}

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Internal config type with required properties except identity
 */
type ClientConfig = Required<
  Omit<
    TogglyPluginOptions,
    | 'instanceId'
    | 'identity'
    | 'groups'
    | 'claims'
    | 'hooks'
    | 'localGates'
    | 'onError'
    | 'allowedKeyIds'
    | 'maxSignatureAgeSeconds'
    | 'metricsBaseUrl'
    | 'telemetryFlushIntervalMs'
  >
> & {
  instanceId?: string;
  identity?: string;
  groups?: string[];
  claims?: Record<string, string>;
  hooks?: Hook[];
  localGates?: TogglyPluginOptions['localGates'];
  onError?: TogglyPluginOptions['onError'];
  allowedKeyIds?: string[];
  maxSignatureAgeSeconds?: number;
  metricsBaseUrl?: string;
  telemetryFlushIntervalMs?: number;
};

function ownerKey(config: TogglyPluginOptions): string {
  return JSON.stringify([
    config.appKey,
    config.environment ?? 'Production',
    config.baseURI ?? 'https://definitions.toggly.io',
    config.metricsBaseUrl ?? 'https://metrics.toggly.io',
    config.enableTelemetry ?? true,
    config.enableUsageTracking ?? true,
    config.enableMetrics ?? true,
    config.telemetryFlushIntervalMs ?? 45000,
    config.verifySignatures ?? false,
    config.allowedKeyIds ?? [],
    config.maxSignatureAgeSeconds ?? null,
  ]);
}

/** Context key excludes routing so queued telemetry retains one bounded reporter. */
export function getTogglyClientContextKey(config: TogglyPluginOptions): string {
  return JSON.stringify([config.instanceId?.trim() || null, config.identity ?? null,
    [...(config.groups ?? [])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
    Object.entries(config.claims ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]);
}

/** Stable browser-owner identity used by framework lifecycle adapters. */
export function getTogglyClientOwnerKey(config: TogglyPluginOptions): string {
  return ownerKey(config);
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Internal client implementation
 */
class TogglyClientInstance {
  private config: ClientConfig;
  private cache: Flags | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  public hookExecutor = new HookExecutor();
  private localGates: LocalGate[] = [];
  private localGateIndex: FlagGateIndex = new Map();
  private lastError: Error | null = null;

  private ws: WebSocket | null = null;
  private wsConnected = false;
  private wsReconnectAttempt = 0;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private cachedDefinitionsRevision: string | null = null;
  private pendingDefinitionsPin: string | null = null;
  private lastFallbackRefresh = 0;
  private readonly ownerKey: string;
  private readonly reporter: TelemetryReporter | null;
  private detachTelemetryLifecycle: (() => void) | null = null;
  private destroyed = false;
  private generation = 0;
  private requestVersion = 0;
  private controllers = new Set<AbortController>();

  constructor(config: TogglyPluginOptions) {
    this.ownerKey = ownerKey(config);
    this.config = {
      baseURI: 'https://definitions.toggly.io',
      verifySignatures: false,
      environment: 'Production',
      flagDefaults: {},
      featureFlagsRefreshInterval: 3 * 60 * 1000,
      enableLiveUpdates: true,
      isDebug: false,
      connectTimeout: 5 * 1000,
      allFeaturesEnabledDuringBuild: false,
      enableTelemetry: true,
      enableUsageTracking: true,
      enableMetrics: true,
      hooks: [],
      ...config,
      instanceId: config.instanceId?.trim() || undefined,
      groups: config.groups ? [...config.groups] : undefined,
      claims: config.claims ? { ...config.claims } : undefined,
    };

    this.clearDefinitionsRevision();

    if (
      isBrowser() &&
      this.config.appKey &&
      this.config.enableTelemetry &&
      (this.config.enableUsageTracking || this.config.enableMetrics)
    ) {
      this.reporter = createTelemetryReporter({
        appKey: this.config.appKey,
        environment: this.config.environment,
        enableTelemetry: true,
        instanceId: this.config.instanceId,
        identity: this.config.identity,
        metricsBaseUrl: this.config.metricsBaseUrl,
        telemetryFlushIntervalMs: this.config.telemetryFlushIntervalMs,
        onDiagnostic: (code) => {
          console.warn(`[Toggly Client] Telemetry diagnostic: ${code}`);
        },
      });
      this.detachTelemetryLifecycle = attachBrowserLifecycle(this.reporter);
    } else {
      this.reporter = null;
    }

    // Register initial hooks
    if (this.config.hooks) {
      this.config.hooks.forEach((hook) => this.hookExecutor.addHook(hook));
    }

    if (this.config.localGates) {
      this.setLocalGates(this.config.localGates);
    }
  }

  matchesContext(config: TogglyPluginOptions): boolean {
    return getTogglyClientContextKey(config) === getTogglyClientContextKey(this.config);
  }

  matchesOwner(config: TogglyPluginOptions): boolean {
    return this.ownerKey === ownerKey(config);
  }

  captureCheck(): ReturnType<TelemetryReporter['captureCheck']> | undefined {
    if (!this.destroyed && this.config.enableUsageTracking && $isReady.get()) {
      return this.reporter?.captureCheck();
    }
  }

  recordUsage(featureKey: string, variant?: string): void {
    if (this.config.enableUsageTracking) this.reporter?.recordUsage(featureKey, variant);
  }

  recordView(featureKey: string, variant?: string): void {
    if (this.config.enableUsageTracking) this.reporter?.recordView(featureKey, variant);
  }

  incrementCounter(metricKey: string, value = 1): void {
    if (this.config.enableMetrics) this.reporter?.incrementCounter(metricKey, value);
  }

  setGauge(metricKey: string, value: number): void {
    if (this.config.enableMetrics) this.reporter?.setGauge(metricKey, value);
  }

  flushTelemetry(): Promise<void> {
    return this.reporter?.flush() ?? Promise.resolve();
  }

  destroy(flush = true): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    this.controllers.forEach(controller => controller.abort());
    this.stopRefreshInterval();
    this.stopWebSocket();
    this.detachTelemetryLifecycle?.();
    this.detachTelemetryLifecycle = null;
    this.reporter?.dispose({ flush });
  }

  setLocalGates(gates: LocalGate[]): void {
    this.localGates = [...gates];
    this.localGateIndex = buildFlagGateIndex(this.localGates);
  }

  captureEvaluation() {
    const localGates = this.localGates.map(gate => ({ ...gate, flagKeys: [...gate.flagKeys] }));
    const localGateIndex = buildFlagGateIndex(localGates);
    return (flagKey: string, definition: EvaluatedDefinitionValue | undefined,
      defaultValue: boolean, entityContext: TogglyEntityContext | null) => {
      const remote = resolveEvaluatedDefinition(definition, entityContext, defaultValue);
      return applyLocalGate(remote, flagKey, localGates, localGateIndex);
    };
  }

  registerContext<T>(kind: string, mapper: (entity: T) => TogglyEntityContext): void {
    registerEntityContext(kind, mapper);
  }

  notifyLocalGatesChanged(): void {
    $localGatesRevision.set($localGatesRevision.get() + 1);
  }

  private get definitionsRevision(): string | null {
    return this.cache ? this.cachedDefinitionsRevision : null;
  }

  private cacheDefinitionsRevision(revision: string | null | undefined): void {
    if (revision && this.cache) this.cachedDefinitionsRevision = revision.replace(/^"+|"+$/g, '');
  }

  private clearDefinitionsRevision(): void {
    this.cachedDefinitionsRevision = null;
    if (canUseStorage() && this.config.appKey) {
      try {
        localStorage.removeItem(
          definitionsRevisionCacheKey(this.config.appKey, this.config.environment),
        );
      } catch {
        // Ignore storage failures
      }
    }
  }

  private getApiUrl(): string {
    const { baseURI, appKey, environment, instanceId, identity, groups, claims } = this.config;

    if (!appKey) {
      return '';
    }

    const url = new URL(baseURI);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/evaluated-signed/${appKey}/${environment}`;

    if (instanceId) {
      for (const key of [...url.searchParams.keys()]) {
        if (key === 'u' || key === 'userId' || key === 'g' || key.startsWith('claim.')) url.searchParams.delete(key);
      }
      url.searchParams.set('i', instanceId);
    }
    else appendEvaluationContext(url, { identity, groups, claims }, 'evaluated');

    return url.toString();
  }

  async fetchFlags(requestVersion = this.requestVersion): Promise<Flags> {
    const generation = this.generation;
    const url = this.getApiUrl();
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), this.config.connectTimeout);

    if (!url || !this.config.appKey) {
      if (this.config.isDebug) {
        console.log('[Toggly Client] Using flag defaults (no appKey):', this.config.flagDefaults);
      }
      clearTimeout(timeoutId);
      this.controllers.delete(controller);
      return { ...this.config.flagDefaults };
    }

    try {
      const pin = this.pendingDefinitionsPin;
      this.pendingDefinitionsPin = null;
      const fetchUrl = appendDefinitionsRevisionParam(url, pin);
      const revision = pin ? null : this.definitionsRevision;

      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers: buildDefinitionFetchHeaders({
          Accept: 'application/json',
          ...(revision ? { 'If-None-Match': revision } : {}),
        }),
        signal: controller.signal,
      });

      if (generation !== this.generation || requestVersion !== this.requestVersion || this.destroyed) return {};

      if (response.status === 304) {
        if (this.cache) {
          if (this.config.isDebug) {
            console.log('[Toggly Client] 304 Not Modified — using cached flags');
          }
          this.cacheDefinitionsRevision(extractDefinitionsRevision(response));
          this.lastError = null;
          return { ...this.cache };
        }
        return { ...this.config.flagDefaults };
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch flags: ${response.status} ${response.statusText}`);
      }

      const responseRevision = extractDefinitionsRevision(response);

      const bodyText = await readResponseBody(response);
      const payload = await parseEvaluatedResponseBody(bodyText, {
        verifySignatures: this.config.verifySignatures,
        baseURI: this.config.baseURI,
        allowedKeyIds: this.config.allowedKeyIds,
        maxSignatureAgeSeconds: this.config.maxSignatureAgeSeconds,
        headers: buildDefinitionFetchHeaders({ Accept: 'application/json' }),
      });
      const flags = unwrapDefsPayload(payload) as Flags;
      if (generation !== this.generation || requestVersion !== this.requestVersion || this.destroyed) return {};
      this.cache = flags;
      this.cachedDefinitionsRevision = null;
      this.cacheDefinitionsRevision(responseRevision);

      if (this.config.isDebug) {
        console.log('[Toggly Client] Fetched flags:', flags);
      }

      this.lastError = null;
      return flags;
    } catch (error) {
      if (generation !== this.generation || requestVersion !== this.requestVersion || this.destroyed) return {};
      const fetchError = error instanceof Error ? error : new Error(String(error));
      this.lastError = fetchError;
      if (!this.destroyed) {
        this.config.onError?.('Error fetching feature flags', error);
        if (generation === this.generation && requestVersion === this.requestVersion && !this.destroyed) $error.set(fetchError);
      }

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

      return { ...this.config.flagDefaults };
    } finally {
      clearTimeout(timeoutId);
      this.controllers.delete(controller);
    }
  }

  private scheduleDebouncedRefresh(forceRevisionReset = false): void {
    if (this.destroyed) return;
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    this.refreshDebounceTimer = setTimeout(() => {
      this.refreshDebounceTimer = null;
      if (this.destroyed) return;
      if (forceRevisionReset) {
        this.clearDefinitionsRevision();
      }
      void this.refresh();
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
    applyFlagsUpdatedPlan(
      planFlagsUpdatedRefresh(message, this.definitionsRevision),
      message,
      {
        refreshJwks: () => this.scheduleDebouncedRefresh(true),
        refreshPinned: (pin) => {
          this.pendingDefinitionsPin = pin;
          this.scheduleDebouncedRefresh(true);
        },
        cacheEtagIfPresent: (etag) => this.cacheDefinitionsRevision(etag),
      },
    );
  }

  startWebSocket(): void {
    if (this.destroyed) {
      return;
    }
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
      this.config.baseURI,
      this.config.appKey,
      this.definitionsRevision,
    );

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (this.ws !== ws || this.destroyed) return;
      this.wsConnected = true;
      this.wsReconnectAttempt = 0;
      this.lastFallbackRefresh = Date.now();
      if (this.config.isDebug) {
        console.log('[Toggly Client] WebSocket connected');
      }
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws || this.destroyed) return;
      const data = event.data;

      if (typeof data === 'string') {
        if (data === 'update' || data === 'flags-updated') {
          // Clear revision so the follow-up GET is unconditional (same as JSON
          // flags-updated path — avoids conditional 304 with stale in-memory flags).
          this.scheduleDebouncedRefresh(true);
          return;
        }

        try {
          const message = JSON.parse(data) as WsSyncMessage;
          if (message.type === 'ping') {
            return;
          }
          if (message.type === 'sync') {
            this.handleWsSyncMessage(message);
            return;
          }
          if (
            message.type === 'flags-updated' ||
            message.type === 'update' ||
            message.type === 'signing-key-updated'
          ) {
            this.handleWsUpdateMessage(message);
          }
        } catch {
          // Unrecognized message, ignore
        }
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws || this.destroyed) return;
      this.wsConnected = false;
      this.ws = null;

      const delay = getNextReconnectDelayMs(this.wsReconnectAttempt);
      this.wsReconnectAttempt += 1;
      this.wsReconnectTimer = setTimeout(() => {
        if (this.destroyed) return;
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

  async init(): Promise<void> {
    const generation = this.generation;
    const requestVersion = ++this.requestVersion;
    const isCurrent = () => !this.destroyed && generation === this.generation && requestVersion === this.requestVersion;
    try {
      const flags = await this.fetchFlags(requestVersion);
      if (!isCurrent()) return;
      this.cache = flags;
      $flags.set(flags);
      if (!isCurrent()) return;
      $isReady.set(true);
      if (!isCurrent()) return;
      $error.set(this.lastError);
      if (!isCurrent()) return;

      // Trigger afterRefresh hooks
      this.hookExecutor.executeAfterRefresh(toBooleanDefinitions(flags), isCurrent);

      if (!isCurrent()) return;
      this.startWebSocket();

      // Start refresh interval if configured
      if (
        this.config.featureFlagsRefreshInterval &&
        this.config.featureFlagsRefreshInterval > 0
      ) {
        this.startRefreshInterval();
      }
    } catch (error) {
      if (!isCurrent()) return;
      $error.set(error as Error);
      $isReady.set(true); // Still mark as ready even on error
      console.error('[Toggly Client] Initialization error:', error);
    }
  }

  async refresh(): Promise<void> {
    const generation = this.generation;
    const requestVersion = ++this.requestVersion;
    const isCurrent = () => !this.destroyed && generation === this.generation && requestVersion === this.requestVersion;
    try {
      const flags = await this.fetchFlags(requestVersion);
      if (!isCurrent()) return;
      this.cache = flags;
      $flags.set(flags);
      if (!isCurrent()) return;
      $isReady.set(true);
      if (!isCurrent()) return;
      $error.set(this.lastError);
      if (!isCurrent()) return;

      // Trigger afterRefresh hooks
      await this.hookExecutor.executeAfterRefresh(toBooleanDefinitions(flags), isCurrent);

      if (this.config.isDebug) {
        console.log('[Toggly Client] Flags refreshed');
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error('[Toggly Client] Refresh error:', error);
    }
  }

  private startRefreshInterval(): void {
    if (this.refreshInterval || this.destroyed) {
      return;
    }

    this.refreshInterval = setInterval(() => {
      if (this.destroyed) return;
      if (
        this.wsConnected &&
        Date.now() - this.lastFallbackRefresh < FALLBACK_REFRESH_INTERVAL
      ) {
        if (this.config.isDebug) {
          console.log('[Toggly Client] Skipping poll — WebSocket connected (fallback window)');
        }
        return;
      }
      this.lastFallbackRefresh = Date.now();
      void this.refresh();
    }, this.config.featureFlagsRefreshInterval);

    if (this.config.isDebug) {
      console.log(
        `[Toggly Client] Started refresh interval: ${this.config.featureFlagsRefreshInterval}ms`,
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

  async updateContext(config: TogglyPluginOptions): Promise<void> {
    if (getTogglyClientContextKey(config) === getTogglyClientContextKey(this.config)) return;
    this.generation++;
    this.controllers.forEach(controller => controller.abort());
    this.stopWebSocket();
    this.config = { ...this.config, identity: config.identity, instanceId: config.instanceId?.trim() || undefined,
      groups: config.groups ? [...config.groups] : undefined,
      claims: config.claims ? { ...config.claims } : undefined,
      flagDefaults: config.flagDefaults ?? this.config.flagDefaults };
    this.cache = null;
    this.clearDefinitionsRevision();
    this.pendingDefinitionsPin = null;
    this.reporter?.setContext({ instanceId: this.config.instanceId, identity: this.config.identity });
    $isReady.set(false);
    $flags.set({ ...this.config.flagDefaults });
    $error.set(null);
    const generation = this.generation;
    await this.refresh();
    if (!this.destroyed && generation === this.generation) {
      this.startWebSocket();
      if (this.config.featureFlagsRefreshInterval > 0) this.startRefreshInterval();
    }
  }

  setIdentity(identity: string): void {
    void this.updateContext({ ...this.config, identity });
  }

  clearIdentity(): void {
    void this.updateContext({ ...this.config, identity: undefined });
  }

}

/**
 * Initialize Toggly client with configuration
 *
 * @param config - Toggly configuration
 */
export async function initTogglyClient(config: TogglyPluginOptions): Promise<void> {
  if (clientStore.clientInstance?.matchesOwner(config)) {
    if (clientStore.clientInstance.matchesContext(config)) return clientStore.clientInitPromise ?? Promise.resolve();
    return clientStore.clientInstance.updateContext(config);
  }

  clientStore.clientInstance?.destroy(false);
  const instance = new TogglyClientInstance(config);
  clientStore.clientInstance = instance;
  $isReady.set(false);
  $flags.set({ ...config.flagDefaults });
  $error.set(null);
  const promise = instance.init();
  clientStore.clientInitPromise = promise;
  try {
    await promise;
  } finally {
    if (clientStore.clientInstance === instance) clientStore.clientInitPromise = null;
  }
}

/**
 * Manually refresh feature flags
 */
export async function refreshFlags(): Promise<void> {
  if (!clientStore.clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return;
  }

  await clientStore.clientInstance.refresh();
}

/**
 * Set user identity for targeting
 *
 * @param identity - User identifier
 */
export function setIdentity(identity: string): void {
  if (!clientStore.clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return;
  }

  clientStore.clientInstance.setIdentity(identity);
}

/**
 * Clear user identity
 */
export function clearIdentity(): void {
  if (!clientStore.clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return;
  }

  clientStore.clientInstance.clearIdentity();
}

/**
 * Stop automatic refresh interval
 */
export function stopRefreshInterval(): void {
  if (clientStore.clientInstance) {
    clientStore.clientInstance.stopRefreshInterval();
  }
}

/**
 * Stop WebSocket live updates and cancel pending reconnect/debounce timers
 */
export function stopWebSocket(): void {
  if (clientStore.clientInstance) {
    clientStore.clientInstance.stopWebSocket();
  }
}

/**
 * Add a hook dynamically
 */
export function addHook(hook: Hook): void {
  if (!clientStore.clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return;
  }
  clientStore.clientInstance.hookExecutor.addHook(hook);
}

/**
 * Remove a hook by name
 * @returns true if hook was found and removed, false otherwise
 */
export function removeHook(name: string): boolean {
  if (!clientStore.clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return false;
  }
  return clientStore.clientInstance.hookExecutor.removeHook(name);
}

/**
 * Register device-local post-filter gates
 */
export function setLocalGates(gates: LocalGate[]): void {
  if (!clientStore.clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return;
  }
  clientStore.clientInstance.setLocalGates(gates);
}

/**
 * Notify subscribers that local gate state changed (no network)
 */
export function notifyLocalGatesChanged(): void {
  if (!clientStore.clientInstance) {
    console.error('[Toggly Client] Client not initialized');
    return;
  }
  clientStore.clientInstance.notifyLocalGatesChanged();
}

/** Record an explicit feature usage in compact browser telemetry. */
export function recordUsage(featureKey: string, variant?: string): void {
  clientStore.clientInstance?.recordUsage(featureKey, variant);
}

/** Record an explicit feature view in compact browser telemetry. */
export function recordView(featureKey: string, variant?: string): void {
  clientStore.clientInstance?.recordView(featureKey, variant);
}

/** Increment an application-level compact counter. */
export function incrementCounter(metricKey: string, value = 1): void {
  clientStore.clientInstance?.incrementCounter(metricKey, value);
}

/** Set an application-level compact gauge. */
export function setGauge(metricKey: string, value: number): void {
  clientStore.clientInstance?.setGauge(metricKey, value);
}

/** Flush compact browser telemetry. */
export function flushTelemetry(): Promise<void> {
  return clientStore.clientInstance?.flushTelemetry() ?? Promise.resolve();
}

/** Dispose the current browser client owner. */
export function disposeTogglyClient(config?: TogglyPluginOptions): void {
  if (
    config &&
    clientStore.clientInstance &&
    !clientStore.clientInstance.matchesOwner(config)
  ) return;
  clientStore.clientInstance?.destroy();
  clientStore.clientInstance = null;
  clientStore.clientInitPromise = null;
  $flags.set({});
  $isReady.set(false);
  $error.set(null);
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
function createFlagStore(
  key: string,
  defaultValue = false,
  entity?: TogglyEntityContext | Record<string, unknown> | null,
  kind?: string,
  consumer = false,
): ConsumerAtom {
  let pending: (() => void) | undefined;
  const flagAtom: TogglyReadableAtom<boolean> = computed(
    [$flags, $localGatesRevision, $isReady],
    (flags) => {
      const definition = flags[key] === undefined ? undefined : JSON.parse(JSON.stringify(flags[key])) as EvaluatedDefinitionValue;
      const instance = clientStore.clientInstance;
      const record = instance?.captureCheck();
      const evaluate = instance?.captureEvaluation();
      const entityContext = normalizeEntityContext(entity, kind);
      const enabled = evaluate ? evaluate(key, definition, defaultValue, entityContext)
        : resolveEvaluatedDefinition(definition, entityContext, defaultValue);
      const report = () => record?.(key, enabled ? 'enabled' : 'disabled');
      if (flagAtom.lc > 0) { report(); pending = undefined; }
      else if (consumer) pending = report;
      return enabled;
    },
  );
  const get = flagAtom.get.bind(flagAtom);
  flagAtom.get = () => {
    const hasSubscriber = flagAtom.lc > 0;
    const record = clientStore.clientInstance?.captureCheck();
    const enabled = get();
    if (!hasSubscriber && !consumer) record?.(key, enabled ? 'enabled' : 'disabled');
    return enabled;
  };
  return Object.assign(flagAtom, { commit: () => { const report = pending; pending = undefined; report?.(); } });
}

/**
 * Create a computed atom that evaluates multiple feature flags
 *
 * @param keys - Array of feature flag keys
 * @param requirement - 'all' or 'any'
 * @param negate - Whether to negate the result
 * @returns Readable atom with the evaluation result
 */
function createGateStore(
  keys: string[],
  requirement: GateRequirement = 'all',
  negate = false,
  entity?: TogglyEntityContext | Record<string, unknown> | null,
  kind?: string,
  consumer = false,
): ConsumerAtom {
  let pending: (() => void) | undefined;
  let evaluatedLeaves: Array<[string, boolean]> = [];
  const gateAtom: TogglyReadableAtom<boolean> = computed(
    [$flags, $localGatesRevision, $isReady],
    (flags) => {
      const selectedKeys = [...keys];
      if (selectedKeys.length === 0) {
        return !negate;
      }

      const snapshot = JSON.parse(JSON.stringify(flags)) as Flags;
      const instance = clientStore.clientInstance;
      const record = instance?.captureCheck();
      const evaluateFlag = instance?.captureEvaluation();
      const entityContext = normalizeEntityContext(entity, kind);
      const leaves: Array<[string, boolean]> = [];
      const evaluate = (key: string) => {
        const enabled = evaluateFlag ? evaluateFlag(key, snapshot[key], false, entityContext)
          : resolveEvaluatedDefinition(snapshot[key], entityContext);
        leaves.push([key, enabled]);
        if (gateAtom.lc > 0) record?.(key, enabled ? 'enabled' : 'disabled');
        return enabled;
      };

      const isEnabled = requirement === 'any' ? selectedKeys.some(evaluate) : selectedKeys.every(evaluate);
      evaluatedLeaves = leaves;
      if (gateAtom.lc > 0) pending = undefined;
      else if (consumer) pending = () => leaves.forEach(([key, result]) => record?.(key, result ? 'enabled' : 'disabled'));

      return negate ? !isEnabled : isEnabled;
    },
  );
  const get = gateAtom.get.bind(gateAtom);
  gateAtom.get = () => {
    const hasSubscriber = gateAtom.lc > 0;
    const record = clientStore.clientInstance?.captureCheck();
    const enabled = get();
    if (!hasSubscriber && !consumer) {
      evaluatedLeaves.forEach(([key, result]) => record?.(key, result ? 'enabled' : 'disabled'));
    }
    return enabled;
  };
  return Object.assign(gateAtom, { commit: () => { const report = pending; pending = undefined; report?.(); } });
}

/** Internal React adapter: pre-subscription reads are projections until commit. */
export interface ConsumerAtom extends TogglyReadableAtom<boolean> { commit(): void }
export const createConsumerFlag = (key: string, defaultValue = false, entity?: TogglyEntityContext | Record<string, unknown> | null, kind?: string): ConsumerAtom =>
  createFlagStore(key, defaultValue, entity, kind, true);
export const createConsumerGate = (keys: string[], requirement: GateRequirement = 'all', negate = false, entity?: TogglyEntityContext | Record<string, unknown> | null, kind?: string): ConsumerAtom =>
  createGateStore(keys, requirement, negate, entity, kind, true);

export function $flag(key: string, defaultValue = false, entity?: TogglyEntityContext | Record<string, unknown> | null, kind?: string): TogglyReadableAtom<boolean> {
  return createFlagStore(key, defaultValue, entity, kind);
}
export function $gate(keys: string[], requirement: GateRequirement = 'all', negate = false, entity?: TogglyEntityContext | Record<string, unknown> | null, kind?: string): TogglyReadableAtom<boolean> {
  return createGateStore(keys, requirement, negate, entity, kind);
}
