/**
 * Server-side Toggly client
 */

import {
  TogglyConfig,
  FeatureFlags,
  IdentityContext,
  TogglyHook,
  EvaluationSeriesData,
  IdentitySeriesData,
  LocalGate,
  TogglyNetworkError,
  mergeConfig,
  buildDefinitionsUrl,
  isFeatureEnabledLocal,
  parseDefinitionsPayload,
  snapshotEvaluatedBooleans,
  fetchWithTimeout,
  createLogger,
  normalizeEntityContext,
  registerContext as registerEntityContext,
} from '@ops-ai/remix-toggly-core';
import type {
  TogglyEntityContext,
  DefinitionsByKey,
  EvalContext,
  FeatureDefinitionModel,
} from '@ops-ai/remix-toggly-core';
import {
  applyLocalGate,
  buildFlagGateIndex,
  type FlagGateIndex,
} from '@ops-ai/toggly-local-gates';
import WebSocket from 'ws';
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
} from './ws-sync';
import { buildDefinitionFetchHeaders } from './sdk-identity';
import {
  parseEvaluatedResponseBody,
  readResponseBody,
} from './signed-response';

/**
 * Server-side Toggly client for fetching and evaluating feature flags
 */
export class TogglyServerClient {
  private readonly config: TogglyConfig;
  private readonly logger: ReturnType<typeof createLogger>;
  /** Compatibility snapshot of locally evaluated booleans (hydration / afterRefresh). */
  private flags: FeatureFlags = {};
  /** Raw definitions-signed models keyed by featureKey. */
  private definitions: Map<string, FeatureDefinitionModel> = new Map();
  private hooks: TogglyHook[] = [];
  private initialized = false;
  /** Dedupes concurrent cold-start definition fetches. */
  private definitionsLoadPromise: Promise<void> | null = null;

  // WebSocket live updates
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnectAttempt = 0;
  private refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private cachedDefinitionsRevision: string | null = null;
  private pendingDefinitionsPin: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private identity?: string;

  private localGates: LocalGate[] = [];
  private localGateIndex: FlagGateIndex = new Map();
  private readonly localGatesListeners = new Set<() => void>();

  constructor(config: TogglyConfig) {
    // Server always uses definitions-signed + local evaluation (OPS-825).
    this.config = mergeConfig({ ...config, evaluationMode: 'local' });
    this.logger = createLogger(this.config.debug ?? false);

    if (this.config.localGates) {
      this.setLocalGates(this.config.localGates);
    }

    if (!this.config.appKey && !this.config.featureDefaults) {
      this.logger.warn(
        'No appKey provided and no featureDefaults set. All features will be disabled.'
      );
    }
  }

  /**
   * Add a hook to the client
   */
  addHook(hook: TogglyHook): void {
    const metadata = hook.getMetadata();
    const exists = this.hooks.find((h) => h.getMetadata().name === metadata.name);

    if (exists) {
      this.logger.warn(`Hook "${metadata.name}" already registered. Skipping.`);
      return;
    }

    this.hooks.push(hook);
    this.logger.debug(`Hook "${metadata.name}" registered.`);
  }

  /**
   * Remove a hook by name
   */
  removeHook(name: string): boolean {
    const index = this.hooks.findIndex((h) => h.getMetadata().name === name);

    if (index > -1) {
      this.hooks.splice(index, 1);
      this.logger.debug(`Hook "${name}" removed.`);
      return true;
    }

    return false;
  }

  /**
   * Register device-local post-filter gates
   */
  setLocalGates(gates: LocalGate[]): void {
    this.localGates = [...gates];
    this.localGateIndex = buildFlagGateIndex(this.localGates);
  }

  /**
   * Notify subscribers that local gate state changed (no network)
   */
  notifyLocalGatesChanged(): void {
    this.localGatesListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        this.logger.error('Local gate listener error:', error);
      }
    });
  }

  /**
   * Subscribe to local gate changes
   */
  subscribeLocalGatesChanged(listener: () => void): () => void {
    this.localGatesListeners.add(listener);
    return () => {
      this.localGatesListeners.delete(listener);
    };
  }

  private buildEvalContext(
    identityOverride?: IdentityContext,
    entityContext?: TogglyEntityContext | null,
  ): EvalContext {
    // When an override object is provided, use its fields (including
    // `identity: undefined` for anonymous). Only fall back to process
    // defaults when no override object is passed.
    if (identityOverride) {
      const claims =
        (identityOverride.claims as Record<string, string> | undefined) ??
        (this.config.claims as Record<string, string> | undefined);
      return {
        identity: identityOverride.identity,
        groups: identityOverride.groups ?? this.config.groups,
        traits:
          identityOverride.traits ??
          identityOverride.claims ??
          this.config.claims,
        claims,
        request: identityOverride.request,
        entity: entityContext ?? null,
      };
    }

    const claims = this.config.claims as Record<string, string> | undefined;
    return {
      identity: this.identity,
      groups: this.config.groups,
      traits: this.config.claims,
      claims,
      entity: entityContext ?? null,
    };
  }

  /**
   * Evaluate a boolean snapshot for a specific identity without relying on
   * shared mutable `this.flags` / `this.identity` (safe under concurrency).
   */
  snapshotFlags(identityOverride?: IdentityContext): FeatureFlags {
    return {
      ...(this.config.featureDefaults ?? {}),
      ...snapshotEvaluatedBooleans(
        this.definitions as DefinitionsByKey,
        this.buildEvalContext(identityOverride),
      ),
    };
  }

  private getEffectiveFlag(
    featureKey: string,
    defaultValue = false,
    entityContext?: TogglyEntityContext | null,
    identityOverride?: IdentityContext,
  ): boolean {
    const evaluated = isFeatureEnabledLocal(
      this.definitions as DefinitionsByKey,
      featureKey,
      this.buildEvalContext(identityOverride, entityContext),
      this.config.featureDefaults?.[featureKey] ?? defaultValue,
    );
    return applyLocalGate(evaluated, featureKey, this.localGates, this.localGateIndex);
  }

  private getDefinitionsRevision(): string | null {
    return this.cachedDefinitionsRevision;
  }

  private cacheDefinitionsRevision(revision: string | null | undefined): void {
    if (!revision) {
      return;
    }
    this.cachedDefinitionsRevision = revision.replace(/^"+|"+$/g, '');
  }

  private scheduleDebouncedRefresh(forceRevisionReset = false): void {
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    this.refreshDebounceTimer = setTimeout(() => {
      this.refreshDebounceTimer = null;
      if (forceRevisionReset) {
        this.cachedDefinitionsRevision = null;
      }
      void this.fetchFlags(this.identity);
    }, REFRESH_DEBOUNCE_MS);
  }

  private handleWsSyncMessage(message: WsSyncMessage): void {
    const previousRevision = this.getDefinitionsRevision();
    if (shouldFetchOnSync(message, previousRevision)) {
      // Do not cache WS etag before HTTP confirms — avoids conditional 304 with stale defs.
      this.scheduleDebouncedRefresh();
      return;
    }
    this.cacheDefinitionsRevision(message.etag);
  }

  private handleWsUpdateMessage(message: WsSyncMessage): void {
    applyFlagsUpdatedPlan(
      planFlagsUpdatedRefresh(message, this.getDefinitionsRevision()),
      message,
      {
        refreshJwks: () => this.scheduleDebouncedRefresh(true),
        refreshPinned: (pin) => {
          this.pendingDefinitionsPin = pin;
          this.cachedDefinitionsRevision = null;
          this.scheduleDebouncedRefresh();
        },
        cacheEtagIfPresent: (etag) => this.cacheDefinitionsRevision(etag),
      },
    );
  }

  private evaluateGateEffective(
    featureKeys: string[],
    requirement: 'all' | 'any' = 'all',
    negate = false,
    defaultValue = false,
    entityContext?: TogglyEntityContext | null,
    identityOverride?: IdentityContext,
  ): boolean {
    if (featureKeys.length === 0) {
      return !negate;
    }

    let result: boolean;
    if (requirement === 'any') {
      result = featureKeys.some((key) =>
        this.getEffectiveFlag(key, defaultValue, entityContext, identityOverride),
      );
    } else {
      result = featureKeys.every((key) =>
        this.getEffectiveFlag(key, defaultValue, entityContext, identityOverride),
      );
    }

    return negate ? !result : result;
  }

  /**
   * Whether the WebSocket connection is active
   */
  get isWsConnected(): boolean {
    return this.wsConnected;
  }

  /**
   * Initialize the client by fetching feature definitions.
   * When already initialized, rebinds identity (including clearing it) and
   * re-snapshots flags without re-fetching (definitions are identity-agnostic).
   * Concurrent cold starts share one fetch; each caller still receives a
   * request-local snapshot for its identity.
   */
  async init(identity?: string): Promise<FeatureFlags> {
    const wasWarm = this.initialized && this.definitions.size > 0;

    if (!wasWarm) {
      if (!this.definitionsLoadPromise) {
        this.definitionsLoadPromise = (async () => {
          await this.fetchFlags();
          this.initialized = true;
          this.startWebSocket();
        })().finally(() => {
          this.definitionsLoadPromise = null;
        });
      }
      await this.definitionsLoadPromise;

      if (identity) {
        await this.executeBeforeIdentify(identity);
        await this.executeAfterIdentify(identity);
      }
    }

    // Always rebind — including `undefined` so identified→anonymous is correct.
    this.identity = identity;
    this.flags = this.snapshotFlags({ identity });
    if (wasWarm) {
      this.logger.debug('Client already initialized; re-snapshotted for identity.');
    }
    return this.flags;
  }

  /**
   * Fetch feature definitions from the API (definitions-signed; no identity query).
   */
  async fetchFlags(identity?: string): Promise<FeatureFlags> {
    if (identity !== undefined) {
      this.identity = identity;
    }

    if (!this.config.appKey) {
      this.logger.debug('No appKey, using featureDefaults.');
      this.definitions = new Map();
      this.flags = this.config.featureDefaults ?? {};
      return this.flags;
    }

    try {
      const pin = this.pendingDefinitionsPin;
      this.pendingDefinitionsPin = null;
      // Local mode: do not pass identity into URL builder (no evaluation query params).
      const url = appendDefinitionsRevisionParam(
        buildDefinitionsUrl(this.config),
        pin,
      );
      this.logger.debug(`Fetching definitions from: ${url}`);

      const revision = pin ? null : this.getDefinitionsRevision();
      const headers = buildDefinitionFetchHeaders(
        revision ? { 'If-None-Match': revision } : {},
      );

      const response = await fetchWithTimeout(url, { headers }, this.config.timeout);

      this.cacheDefinitionsRevision(extractDefinitionsRevision(response));

      if (response.status === 304) {
        this.logger.debug('Definitions unchanged (304)');
        return this.flags;
      }

      if (!response.ok) {
        throw new TogglyNetworkError(
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const bodyText = await readResponseBody(response);
      const parsed = await parseEvaluatedResponseBody(bodyText, {
        verifySignatures: this.config.verifySignatures,
        baseUrl: this.config.baseUrl ?? 'https://definitions.toggly.io',
        allowedKeyIds: this.config.allowedKeyIds,
        maxSignatureAgeSeconds: this.config.maxSignatureAgeSeconds,
        headers: buildDefinitionFetchHeaders({}),
      });

      this.definitions = parseDefinitionsPayload(parsed);
      this.flags = {
        ...(this.config.featureDefaults ?? {}),
        ...snapshotEvaluatedBooleans(this.definitions, this.buildEvalContext()),
      };
      this.logger.debug(`Fetched ${this.definitions.size} definitions.`);

      // Execute afterRefresh hooks
      await this.executeAfterRefresh(this.flags);

      return this.flags;
    } catch (error) {
      this.logger.warn('Failed to fetch flags, preserving last-known-good flags when available.', error);
      this.config.onError?.('Error fetching feature flags', error);
      if (Object.keys(this.flags).length === 0) {
        this.flags = this.config.featureDefaults ?? {};
      }
      return this.flags;
    }
  }

  /**
   * Get all flags
   */
  getFlags(): FeatureFlags {
    return { ...this.flags };
  }

  /**
   * Check if a feature is enabled
   */
  async isEnabled(
    featureKey: string,
    context?: IdentityContext,
    defaultValue = false,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean> {
    const entityContext = normalizeEntityContext(entity, kind);

    // Execute beforeEvaluation hooks
    const hookData = await this.executeBeforeEvaluation(featureKey, defaultValue);

    const result = this.getEffectiveFlag(featureKey, defaultValue, entityContext, context);

    // Execute afterEvaluation hooks
    await this.executeAfterEvaluation(featureKey, hookData, result);

    return result;
  }

  registerContext<T>(
    kind: string,
    mapper: (entity: T) => TogglyEntityContext,
  ): void {
    registerEntityContext(kind, mapper);
  }

  /**
   * Check if a feature is disabled
   */
  async isDisabled(
    featureKey: string,
    context?: IdentityContext,
    defaultValue = true,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean> {
    return !(await this.isEnabled(featureKey, context, !defaultValue, entity, kind));
  }

  /**
   * Evaluate a feature gate (multiple features)
   */
  async evaluateGate(
    featureKeys: string[],
    requirement: 'all' | 'any' = 'all',
    negate = false,
    defaultValue = false,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
    identityOverride?: IdentityContext,
  ): Promise<boolean> {
    const entityContext = normalizeEntityContext(entity, kind);

    // Execute beforeEvaluation for first feature
    const firstKey = featureKeys[0] ?? 'gate';
    const hookData = await this.executeBeforeEvaluation(firstKey, defaultValue);

    const result = this.evaluateGateEffective(
      featureKeys,
      requirement,
      negate,
      defaultValue,
      entityContext,
      identityOverride,
    );

    // Execute afterEvaluation
    await this.executeAfterEvaluation(firstKey, hookData, result);

    return result;
  }

  /**
   * Get the server context for client hydration
   */
  getServerContext(): {
    flags: FeatureFlags;
    appKey?: string;
    environment?: string;
    fetchedAt: number;
  } {
    return {
      flags: this.flags,
      appKey: this.config.appKey,
      environment: this.config.environment,
      fetchedAt: Date.now(),
    };
  }

  // WebSocket live updates

  /**
   * Start WebSocket connection for live updates
   */
  private startWebSocket(): void {
    if (!this.config.appKey) {
      return;
    }

    if (this.ws) {
      return;
    }

    const baseUrl = this.config.baseUrl ?? 'https://definitions.toggly.io';
    const wsUrl = buildWebSocketUrl(baseUrl, this.config.appKey, this.getDefinitionsRevision());
    this.logger.debug(`WebSocket connecting to: ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.wsConnected = true;
        this.wsReconnectAttempt = 0;
        this.logger.debug('WebSocket connected');
      });

      this.ws.on('message', (data: Buffer) => {
        const text = data.toString();

        if (text === 'update' || text === 'flags-updated') {
          this.scheduleDebouncedRefresh();
          return;
        }

        try {
          const message = JSON.parse(text) as WsSyncMessage;
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
      });

      this.ws.on('close', () => {
        this.wsConnected = false;
        this.ws = null;
        this.logger.debug('WebSocket disconnected, scheduling reconnect');
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        this.logger.error('WebSocket error:', error.message);
        // close event will fire after error, triggering reconnect
      });
    } catch (error) {
      this.logger.error('Failed to create WebSocket:', error);
      this.ws = null;
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule WebSocket reconnection
   */
  private scheduleReconnect(): void {
    if (this.wsReconnectTimer) {
      return;
    }
    const delay = getNextReconnectDelayMs(this.wsReconnectAttempt);
    this.wsReconnectAttempt += 1;
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.startWebSocket();
    }, delay);
  }

  /**
   * Stop WebSocket connection and cleanup
   */
  private stopWebSocket(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
      this.refreshDebounceTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
      this.wsConnected = false;
    }
  }

  /**
   * Close the client and cleanup all resources
   */
  close(): void {
    this.stopWebSocket();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.logger.debug('TogglyServerClient closed');
  }

  // Hook execution methods

  private async executeBeforeEvaluation(
    flagKey: string,
    defaultValue?: boolean
  ): Promise<Map<string, EvaluationSeriesData | void>> {
    const dataMap = new Map<string, EvaluationSeriesData | void>();

    for (const hook of this.hooks) {
      if (hook.beforeEvaluation) {
        try {
          const data = await hook.beforeEvaluation(flagKey, defaultValue);
          dataMap.set(hook.getMetadata().name, data);
        } catch (error) {
          this.logger.error(
            `Error in hook "${hook.getMetadata().name}.beforeEvaluation":`,
            error
          );
        }
      }
    }

    return dataMap;
  }

  private async executeAfterEvaluation(
    flagKey: string,
    dataMap: Map<string, EvaluationSeriesData | void>,
    result: boolean
  ): Promise<void> {
    // Execute in reverse order
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const hook = this.hooks[i];
      if (hook.afterEvaluation) {
        try {
          const data = dataMap.get(hook.getMetadata().name);
          await hook.afterEvaluation(flagKey, data, result);
        } catch (error) {
          this.logger.error(
            `Error in hook "${hook.getMetadata().name}.afterEvaluation":`,
            error
          );
        }
      }
    }
  }

  private async executeBeforeIdentify(
    identity: string
  ): Promise<Map<string, IdentitySeriesData | void>> {
    const dataMap = new Map<string, IdentitySeriesData | void>();

    for (const hook of this.hooks) {
      if (hook.beforeIdentify) {
        try {
          const data = await hook.beforeIdentify(identity);
          dataMap.set(hook.getMetadata().name, data);
        } catch (error) {
          this.logger.error(
            `Error in hook "${hook.getMetadata().name}.beforeIdentify":`,
            error
          );
        }
      }
    }

    return dataMap;
  }

  private async executeAfterIdentify(identity: string): Promise<void> {
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const hook = this.hooks[i];
      if (hook.afterIdentify) {
        try {
          await hook.afterIdentify(identity, undefined);
        } catch (error) {
          this.logger.error(
            `Error in hook "${hook.getMetadata().name}.afterIdentify":`,
            error
          );
        }
      }
    }
  }

  private async executeAfterRefresh(flags: FeatureFlags): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.afterRefresh) {
        try {
          await hook.afterRefresh(flags);
        } catch (error) {
          this.logger.error(
            `Error in hook "${hook.getMetadata().name}.afterRefresh":`,
            error
          );
        }
      }
    }
  }
}

/**
 * Create a new server client instance
 */
export function createServerClient(config: TogglyConfig): TogglyServerClient {
  return new TogglyServerClient(config);
}
