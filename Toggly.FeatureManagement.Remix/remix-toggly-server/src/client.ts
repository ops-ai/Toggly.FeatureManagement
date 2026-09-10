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
  TelemetryRuntime,
  resolveTelemetryEnableFlag,
  isTelemetryEnvDisabled,
  type MetricsFeatureOptions,
  type UsageSender,
  type MetricsSender,
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
import {
  getAmbientEvalOverrides,
  mergeIdentityContext,
} from './eval-context-store';
import { createGrpcClients, isGrpcAvailable } from '@ops-ai/remix-toggly-core/telemetry/grpc';

function resolveServerTelemetryFlags(
  config: TogglyConfig,
): Pick<TogglyConfig, 'enableUsageTracking' | 'enableMetrics'> {
  const hasAppKey = Boolean(config.appKey);
  return {
    enableUsageTracking: resolveTelemetryEnableFlag(
      config.enableUsageTracking,
      hasAppKey,
    ),
    enableMetrics: resolveTelemetryEnableFlag(config.enableMetrics, hasAppKey),
  };
}

function resolveGrpcClients(config: TogglyConfig): {
  usageClient?: UsageSender | null;
  metricsClient?: MetricsSender | null;
} {
  if (config.usageClient !== undefined || config.metricsClient !== undefined) {
    return {
      usageClient: config.usageClient,
      metricsClient: config.metricsClient,
    };
  }

  const flags = resolveServerTelemetryFlags(config);
  if (!flags.enableUsageTracking && !flags.enableMetrics) {
    return {};
  }

  const transport = config.telemetryTransport ?? 'grpc';
  if (transport !== 'grpc') {
    return {};
  }

  if (!isGrpcAvailable()) {
    console.warn(
      '[Toggly] Usage/metrics enabled but @grpc/grpc-js and @grpc/proto-loader are not installed. ' +
        'Install them to send telemetry: npm install @grpc/grpc-js @grpc/proto-loader',
    );
    return { usageClient: null, metricsClient: null };
  }

  const clients = createGrpcClients(config.metricsBaseUrl);
  if (!clients) {
    console.warn('[Toggly] Failed to create gRPC clients; telemetry transport disabled');
    return { usageClient: null, metricsClient: null };
  }
  return { usageClient: clients.usage, metricsClient: clients.metrics };
}

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
  /** Single-flight for definition GET so concurrent joiners are not double-counted. */
  private definitionsFetchInFlight: Promise<FeatureFlags> | null = null;

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
  private telemetry: TelemetryRuntime | null = null;

  constructor(config: TogglyConfig) {
    // Server always uses definitions-signed + local evaluation (OPS-825).
    const telemetryFlags = resolveServerTelemetryFlags(config);
    const grpcClients = resolveGrpcClients({ ...config, ...telemetryFlags });
    this.config = mergeConfig({
      ...config,
      ...telemetryFlags,
      ...grpcClients,
      evaluationMode: 'local',
      telemetryTransport: config.telemetryTransport ?? 'grpc',
      telemetryAttachProcessHandlers:
        config.telemetryAttachProcessHandlers ??
        (config.telemetryTransport ?? 'grpc') === 'grpc',
    });
    this.logger = createLogger(this.config.debug ?? false);

    if (this.config.localGates) {
      this.setLocalGates(this.config.localGates);
    }

    if (!this.config.appKey && !this.config.featureDefaults) {
      this.logger.warn(
        'No appKey provided and no featureDefaults set. All features will be disabled.'
      );
    }

    this.startTelemetry();
  }

  private startTelemetry(): void {
    if (!this.config.appKey || isTelemetryEnvDisabled()) {
      return;
    }
    if (!this.config.enableUsageTracking && !this.config.enableMetrics) {
      return;
    }
    if (this.telemetry) {
      void this.telemetry.close();
      this.telemetry = null;
    }
    this.telemetry = new TelemetryRuntime({
      appKey: this.config.appKey,
      environment: this.config.environment ?? 'Production',
      metricsBaseUrl: this.config.metricsBaseUrl,
      enableUsageTracking: this.config.enableUsageTracking,
      enableMetrics: this.config.enableMetrics,
      usageFlushInterval: this.config.usageFlushInterval,
      metricsFlushInterval: this.config.metricsFlushInterval,
      instanceName: this.config.instanceName,
      appVersion: this.config.appVersion,
      transport: this.config.telemetryTransport ?? 'grpc',
      attachProcessHandlers: this.config.telemetryAttachProcessHandlers,
      usageClient: this.config.usageClient,
      metricsClient: this.config.metricsClient,
      fetchImpl: this.config.telemetryFetch,
    });
    this.telemetry.start();
  }

  private recordCheckForKey(
    featureKey: string,
    enabled: boolean,
    identityOverride?: IdentityContext,
  ): void {
    if (!this.telemetry?.usageEnabled) {
      return;
    }
    const identity = identityOverride?.identity ?? this.identity;
    this.telemetry.recordCheck(featureKey, enabled, identity);
  }

  /** Soft-fail wrapper — definition refresh must not throw from telemetry. */
  private noteDefinitionCacheHit(): void {
    try {
      this.telemetry?.recordDefinitionCacheHit();
    } catch {
      // Telemetry must never break flag refresh.
    }
  }

  private noteDefinitionCacheMiss(): void {
    try {
      this.telemetry?.recordDefinitionCacheMiss();
    } catch {
      // Telemetry must never break flag refresh.
    }
  }

  private normalizeDefinitionsRevision(
    revision: string | null | undefined,
  ): string | null {
    if (!revision) {
      return null;
    }
    return revision.replace(/^"+|"+$/g, '');
  }

  private definitionsRevisionsMatch(
    previous: string | null | undefined,
    incoming: string | null | undefined,
  ): boolean {
    const a = this.normalizeDefinitionsRevision(previous);
    const b = this.normalizeDefinitionsRevision(incoming);
    if (!a || !b) {
      return false;
    }
    return a === b;
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
    // Ambient (loader/action ALS) merges with per-call override; per-call wins.
    // When neither is set, fall back to process defaults (identity / config).
    const merged = mergeIdentityContext(
      getAmbientEvalOverrides(),
      identityOverride,
    );

    if (merged) {
      // Prefer claims for UserClaims filters; traits remain a separate bag.
      const claims =
        (merged.claims as Record<string, string> | undefined) ??
        (this.config.claims as Record<string, string> | undefined);
      return {
        identity: merged.identity,
        groups: merged.groups ?? this.config.groups,
        traits: merged.traits ?? this.config.claims,
        claims,
        request: merged.request,
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
    const normalized = this.normalizeDefinitionsRevision(revision);
    if (!normalized) {
      return;
    }
    this.cachedDefinitionsRevision = normalized;
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

    // Record once per key (Next/Node parity), then combine.
    const checks = featureKeys.map((key) => {
      const enabled = this.getEffectiveFlag(
        key,
        defaultValue,
        entityContext,
        identityOverride,
      );
      this.recordCheckForKey(key, enabled, identityOverride);
      return enabled;
    });

    let result: boolean;
    if (requirement === 'any') {
      result = checks.some(Boolean);
    } else {
      result = checks.every(Boolean);
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
   * Counts one definition-refresh hit/miss per performed attempt; concurrent
   * in-flight joiners await the same fetch and are not counted.
   */
  async fetchFlags(identity?: string): Promise<FeatureFlags> {
    if (identity !== undefined) {
      this.identity = identity;
    }

    if (this.definitionsFetchInFlight) {
      return this.definitionsFetchInFlight;
    }

    this.definitionsFetchInFlight = this.performDefinitionsFetch();
    try {
      return await this.definitionsFetchInFlight;
    } finally {
      this.definitionsFetchInFlight = null;
    }
  }

  private async performDefinitionsFetch(): Promise<FeatureFlags> {
    if (!this.config.appKey) {
      this.logger.debug('No appKey, using featureDefaults.');
      this.definitions = new Map();
      this.flags = this.config.featureDefaults ?? {};
      return this.flags;
    }

    let outcomeRecorded = false;

    try {
      const pin = this.pendingDefinitionsPin;
      this.pendingDefinitionsPin = null;
      // Local mode: do not pass identity into URL builder (no evaluation query params).
      const url = appendDefinitionsRevisionParam(
        buildDefinitionsUrl(this.config),
        pin,
      );
      this.logger.debug(`Fetching definitions from: ${url}`);

      // Pin forces a cache-proof GET; do not treat prior etag as still current.
      const previousRevision = pin ? null : this.getDefinitionsRevision();
      const headers = buildDefinitionFetchHeaders(
        previousRevision ? { 'If-None-Match': previousRevision } : {},
      );

      const response = await fetchWithTimeout(url, { headers }, this.config.timeout);

      const responseRevision = this.normalizeDefinitionsRevision(
        extractDefinitionsRevision(response),
      );

      if (response.status === 304) {
        if (responseRevision) {
          this.cacheDefinitionsRevision(responseRevision);
        }
        this.noteDefinitionCacheHit();
        outcomeRecorded = true;
        this.logger.debug('Definitions unchanged (304)');
        return this.flags;
      }

      if (!response.ok) {
        throw new TogglyNetworkError(
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      // Always parse/apply the body on HTTP 200. Equal revision is still a cache
      // hit (CDN replay), but the body must still be applied.
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
      if (responseRevision) {
        this.cacheDefinitionsRevision(responseRevision);
      }
      this.logger.debug(`Fetched ${this.definitions.size} definitions.`);

      if (this.definitionsRevisionsMatch(previousRevision, responseRevision)) {
        this.noteDefinitionCacheHit();
      } else {
        this.noteDefinitionCacheMiss();
      }
      outcomeRecorded = true;

      // Execute afterRefresh hooks
      await this.executeAfterRefresh(this.flags);

      return this.flags;
    } catch (error) {
      this.logger.warn('Failed to fetch flags, preserving last-known-good flags when available.', error);
      this.config.onError?.('Error fetching feature flags', error);

      // Network error keeping last-good definitions only — not featureDefaults alone.
      if (!outcomeRecorded && this.definitions.size > 0) {
        this.noteDefinitionCacheHit();
      }

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
    this.recordCheckForKey(featureKey, result, context);

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
    if (this.telemetry) {
      void this.telemetry.close();
      this.telemetry = null;
    }
    this.logger.debug('TogglyServerClient closed');
  }

  /** Record a feature "used" interaction (usage telemetry). */
  recordUsage(featureKey: string, identity?: string, variant?: string): void {
    this.telemetry?.recordUsage(featureKey, identity ?? this.identity, variant);
  }

  /** Record a feature "viewed" event (usage telemetry). */
  recordView(featureKey: string, identity?: string, variant?: string): void {
    this.telemetry?.recordView(featureKey, identity ?? this.identity, variant);
  }

  measure(
    metricKey: string,
    value: number,
    options?: MetricsFeatureOptions,
  ): void {
    this.telemetry?.measure(metricKey, value, options);
  }

  incrementCounter(
    metricKey: string,
    value = 1,
    options?: MetricsFeatureOptions,
  ): void {
    this.telemetry?.incrementCounter(metricKey, value, options);
  }

  observe(
    metricKey: string,
    value: number,
    options?: MetricsFeatureOptions,
  ): void {
    this.telemetry?.observe(metricKey, value, options);
  }

  async flushTelemetry(): Promise<void> {
    await this.telemetry?.flushAll();
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
