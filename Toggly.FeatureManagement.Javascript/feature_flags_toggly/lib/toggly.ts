import { v4 as uuidv4 } from 'uuid';
import { createTelemetryReporter, type TelemetryReporter } from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';
import { FeatureRequirement, StorageKeys, TogglyConfig, VariantResult, EvaluatedVariantDef } from './models';
import { HookExecutor } from './hooks';
import type { Hook, TogglyEvaluationContext, EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types';
import {
  appendEvaluationContext,
  evaluationContextCacheKey,
  normalizeEvaluationClaims,
  isCacheLruEnabled,
  parseCacheLruIndex,
  removeCacheLruKeys,
  selectCacheLruKeysToEvict,
  serializeCacheLruIndex,
  touchCacheLruKey,
  type CacheLruIndex,
  normalizeEntityContext,
  registerContext as registerEntityContext,
  resolveEvaluatedDefinition,
  toBooleanDefinitions,
} from '@ops-ai/toggly-hooks-types';
import {
  applyLocalGate,
  buildFlagGateIndex,
  type FlagGateIndex,
  type LocalGate,
} from '@ops-ai/toggly-local-gates';
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
  parseDefinitionsFromRaw,
  parseSignedEnvelope,
  verifySignedDefinitions,
  type JwkSet,
} from './signed-defs-verify';

const canUseStorage = (() => {
  try {
    return typeof window !== 'undefined' && window.localStorage !== undefined;
  } catch {
    return false;
  }
})();

type EvaluationSnapshot = {
  flags: EvaluatedDefinitions;
  variants: { [key: string]: EvaluatedVariantDef } | null;
  localGates: LocalGate[];
  localGateIndex: FlagGateIndex;
  recordCheck?: (featureKey: string, variant: string) => void;
};

export class Toggly {
  private static _config: TogglyConfig;
  private static _generation = 0;
  private static _active = false;
  private static _instanceId = '';
  private static _requests = new Set<AbortController>();
  private static _contextMemory = new Map<string, string | null>();
  private static _contextMemoryOnly = new Set<string>();
  private static _refreshInterval: number | undefined;
  private static _hookExecutor = new HookExecutor();
  private static _localGates: LocalGate[] = [];
  private static _inMemoryJwks: JwkSet | null = null;
  private static _localGateIndex: FlagGateIndex = new Map();
  private static _localGatesChangedListeners = new Set<() => void>();
  private static _inMemoryFlags: EvaluatedDefinitions | null = null;
  private static _inMemoryVariants: { [key: string]: EvaluatedVariantDef } | null = null;
  private static _hasLoadedFlags = false;
  private static _lastError: string | undefined;
  private static _telemetry: TelemetryReporter | undefined;
  private static _retiredTelemetry: TelemetryReporter | undefined;
  private static _detachTelemetry: (() => void) | undefined;

  static _ws: WebSocket | null = null;
  static _wsConnected: boolean = false;
  static _wsReconnectTimer: any = null;
  static _wsReconnectAttempt: number = 0;
  static _refreshDebounceTimer: any = null;
  static _cachedDefinitionsRevision: string | null = null;
  private static _cachedRevisionContext: string | null = null;
  static _pendingDefinitionsPin: string | null = null;
  static _lastFallbackRefresh: number = 0;
  static _fallbackRefreshInterval: number = 20 * 60 * 1000;

  private static get _revisionCacheKey(): string {
    return StorageKeys.definitionsRevisionCacheKey(
      Toggly._config?.appKey ?? '',
      Toggly._config?.environment ?? 'Production',
      `v2:${Toggly._config?.enableVariants ? 'variants' : 'evaluated'}:${Toggly._contextCacheKey}`,
    );
  }

  private static get definitionsRevision(): string | null {
    if (Toggly._cachedDefinitionsRevision && Toggly._cachedRevisionContext === Toggly._revisionCacheKey) {
      return Toggly._cachedDefinitionsRevision;
    }
    if (!Toggly._persistCache || !Toggly._cachedFeatureFlags || (Toggly._config.enableVariants && !Toggly.variantsValue)) {
      return null;
    }
    try {
      return localStorage.getItem(Toggly._revisionCacheKey);
    } catch {
      return null;
    }
  }

  private static cacheDefinitionsRevision(revision: string | null | undefined): void {
    if (!revision) {
      return;
    }
    Toggly._cachedDefinitionsRevision = revision;
    Toggly._cachedRevisionContext = Toggly._revisionCacheKey;
    if (!Toggly._persistCache) {
      return;
    }
    try {
      localStorage.setItem(Toggly._revisionCacheKey, revision);
    } catch (error) {
      Toggly._reportError('Error writing definitions revision cache', error);
    }
  }

  private static scheduleDebouncedRefresh(forceJwksRefresh = false): void {
    if (Toggly._refreshDebounceTimer) {
      clearTimeout(Toggly._refreshDebounceTimer);
    }
    const generation = Toggly._generation;
    Toggly._refreshDebounceTimer = setTimeout(() => {
      if (generation !== Toggly._generation) return;
      Toggly._refreshDebounceTimer = null;
      if (forceJwksRefresh && Toggly._config.verifySignatures) {
        // Force re-fetch by clearing revision so signing key rotation always pulls fresh defs.
        Toggly._cachedDefinitionsRevision = null;
        Toggly._inMemoryJwks = null;
      }
      Toggly.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private static handleWsSyncMessage(message: WsSyncMessage): void {
    const previousRevision = Toggly.definitionsRevision;
    if (shouldFetchOnSync(message, previousRevision)) {
      // Do not cache WS etag before HTTP confirms — avoids conditional 304 with stale defs.
      Toggly.scheduleDebouncedRefresh();
      return;
    }
    if (message.etag) {
      Toggly.cacheDefinitionsRevision(message.etag);
    }
  }

  private static handleWsUpdateMessage(message: WsSyncMessage): void {
    const refreshPlan = planFlagsUpdatedRefresh(message, Toggly.definitionsRevision);
    const hooks = {
      refreshJwks(): void {
        Toggly.scheduleDebouncedRefresh(true);
      },
      refreshPinned(revisionPin: string | null): void {
        Toggly._pendingDefinitionsPin = revisionPin;
        Toggly._cachedDefinitionsRevision = null;
        Toggly.scheduleDebouncedRefresh();
      },
      cacheEtagIfPresent(etagValue: string): void {
        Toggly.cacheDefinitionsRevision(etagValue);
      },
    };
    applyFlagsUpdatedPlan(refreshPlan, message, hooks);
  }

  private static buildFetchHeaders(skipIfNoneMatch = false): HeadersInit {
    const revision = skipIfNoneMatch ? null : Toggly.definitionsRevision;
    return buildDefinitionFetchHeaders(
      revision ? { 'If-None-Match': revision } : {},
    );
  }

  /**
   * Consume a one-shot WS pin: append ?rev= and omit If-None-Match so the
   * post-notify GET cannot 304 against a revision that HTTP has not confirmed.
   */
  private static consumePendingDefinitionsRequest(
    mode: 'evaluated' | 'variants',
  ): { url: string; headers: HeadersInit } {
    const pin = Toggly._pendingDefinitionsPin;
    Toggly._pendingDefinitionsPin = null;
    return {
      url: appendDefinitionsRevisionParam(Toggly.buildEvaluatedUrl(mode), pin),
      headers: Toggly.buildFetchHeaders(!!pin),
    };
  }

  private static applyFetchRevision(response: Response): void {
    const revision = extractDefinitionsRevision(response);
    if (revision) {
      Toggly.cacheDefinitionsRevision(revision.replace(/^"+|"+$/g, ''));
    }
  }

  private static get _persistCache(): boolean {
    return Toggly._config?.persistCache !== false && canUseStorage;
  }

  private static get _contextCacheKey(): string {
    if (Toggly._instanceId) return `i:${encodeURIComponent(Toggly._instanceId)}`;
    const context = Toggly.evaluationContext;
    // Preserve safe identity-only caches; structured context needs escaped boundaries.
    if (!context.groups && !context.claims && !context.identity?.includes('|')) {
      return evaluationContextCacheKey(context);
    }
    const claims = normalizeEvaluationClaims(context.claims) ?? {};
    return `v2:${encodeURIComponent(JSON.stringify([
      context.identity ?? '',
      [...(context.groups ?? [])].sort((a, b) => a.localeCompare(b)),
      Object.entries(claims).sort(([a], [b]) => a.localeCompare(b)),
    ]))}`;
  }

  private static get _flagsCacheKey(): string {
    return StorageKeys.flagsCacheKey(
      Toggly._config?.appKey ?? '',
      Toggly._config?.environment ?? 'Production',
      `v3:${Toggly._config?.enableVariants ? 'variants' : 'evaluated'}:${Toggly._contextCacheKey}`,
    );
  }

  static get lastError(): string | undefined {
    return Toggly._lastError;
  }

  private static _reportError(message: string, error?: unknown): void {
    Toggly._lastError = message;
    Toggly._config?.onError?.(message, error);
    if (Toggly._config?.isDebug) {
      console.warn(`[Toggly] ${message}`, error);
    }
  }

  private static _getFallbackFlags(): EvaluatedDefinitions {
    if (Toggly._hasLoadedFlags && Toggly._inMemoryFlags) {
      return Toggly._inMemoryFlags;
    }

    return Toggly._cachedFeatureFlags ?? Toggly._inMemoryFlags ?? Toggly._config.flagDefaults ?? {};
  }

  private static get _variantsCacheKey(): string {
    return StorageKeys.variantsCacheKey(
      Toggly._config?.appKey ?? '',
      Toggly._config?.environment ?? 'Production',
      Toggly._contextCacheKey,
    );
  }

  static init(config: TogglyConfig = {} as TogglyConfig): Promise<{ [key: string]: boolean }> {
    const reusableTelemetry = Toggly._active && Toggly._telemetry &&
      (Toggly._config.metricsBaseUrl ?? 'https://metrics.toggly.io') === (config.metricsBaseUrl ?? 'https://metrics.toggly.io') &&
      (Toggly._config.telemetryFlushIntervalMs ?? 45000) === (config.telemetryFlushIntervalMs ?? 45000) &&
      (Toggly._config.enableTelemetry !== false) === (config.enableTelemetry !== false) &&
      Toggly._config.onError === config.onError;
    Toggly.stopDefinitionResources();
    if (!reusableTelemetry) Toggly.stopTelemetry(false);
    Toggly._inMemoryJwks = null;
    Toggly._pendingDefinitionsPin = null;
    Toggly._config = Object.assign({
      baseURI: 'https://definitions.toggly.io',
      verifySignatures: false,
      reloadOnFeatureFlagValidation: false,
      connectTimeout: 5 * 1000,
      featureFlagsRefreshInterval: 3 * 60 * 1000,
      isDebug: false,
      environment: 'Production',
      flagDefaults: {},
      hooks: [],
      persistCache: true
    }, config);
    Toggly._inMemoryFlags = Toggly._config.flagDefaults
      ? { ...Toggly._config.flagDefaults }
      : null;
    Toggly._hasLoadedFlags = false;
    Toggly._inMemoryVariants = null;
    Toggly._lastError = undefined;
    Toggly._cachedDefinitionsRevision = null;
    Toggly._wsReconnectAttempt = 0;

    // Register initial hooks
    if (Toggly._config.hooks) {
      Toggly._config.hooks.forEach(hook => Toggly._hookExecutor.addHook(hook));
    }

    // Seed all targeting fields before any hooks, cache reads or background work.
    if (config.groups !== undefined) Toggly.groups = config.groups;
    if (config.claims !== undefined) Toggly.claims = config.claims;
    if (config.identity !== undefined) {
      Toggly.identity = config.identity;
    } else if (!Toggly.identity) {
      Toggly.identity = uuidv4();
    }

    if (Toggly._config.localGates) {
      Toggly.setLocalGates(Toggly._config.localGates);
    }

    Toggly._instanceId = typeof config.instanceId === 'string' ? config.instanceId.trim() : '';
    Toggly._active = true;
    Toggly.startRefreshInterval();
    Toggly.startWebSocket();
    Toggly.startTelemetry();

    return Toggly.refresh();
  }

  private static startTelemetry(): void {
    if (Toggly._telemetry) {
      Toggly.updateTelemetryContext();
      return;
    }
    if (!Toggly._config.appKey || Toggly._config.enableTelemetry === false ||
        typeof window === 'undefined' || typeof document === 'undefined') return;
    const onError = Toggly._config.onError;
    try {
      const reporter = createTelemetryReporter({
        appKey: Toggly._config.appKey,
        environment: Toggly._config.environment,
        instanceId: Toggly._instanceId,
        identity: Toggly.identity,
        enableTelemetry: Toggly._config.enableTelemetry,
        metricsBaseUrl: Toggly._config.metricsBaseUrl,
        telemetryFlushIntervalMs: Toggly._config.telemetryFlushIntervalMs,
        onDiagnostic: code => {
          try { onError?.(`Frontend telemetry: ${code}`); } catch { /* Keep evaluation independent. */ }
        },
      });
      Toggly._telemetry = reporter;
      Toggly._detachTelemetry = attachBrowserLifecycle(reporter);
    } catch {
      try { onError?.('Frontend telemetry: invalid-option'); } catch { /* Keep evaluation independent. */ }
    }
  }

  private static updateTelemetryContext(): void {
    const reporter = Toggly._telemetry;
    if (!reporter) return;
    reporter.setContext({
      appKey: Toggly._config.appKey ?? '', environment: Toggly._config.environment,
      instanceId: Toggly._instanceId, identity: Toggly.identity,
    });
    Toggly._detachTelemetry?.();
    Toggly._detachTelemetry = attachBrowserLifecycle(reporter);
  }

  private static stopTelemetry(flush = true): void {
    try { Toggly._detachTelemetry?.(); } catch { /* Best-effort teardown. */ }
    Toggly._detachTelemetry = undefined;
    // Repeated public cleanup is idempotent; replacement explicitly discards.
    if (flush && !Toggly._telemetry) return;
    // Cancel even an earlier final send before creating another transport owner.
    Toggly._retiredTelemetry?.dispose({ flush: false });
    Toggly._retiredTelemetry = undefined;
    const reporter = Toggly._telemetry;
    Toggly._telemetry = undefined;
    if (!reporter) return;
    reporter.dispose({ flush });
    if (flush) {
      Toggly._retiredTelemetry = reporter;
      void reporter.flush().then(() => {
        if (Toggly._retiredTelemetry === reporter) Toggly._retiredTelemetry = undefined;
      });
    }
  }

  private static captureEvaluation(flags?: EvaluatedDefinitions): EvaluationSnapshot {
    const recordCheck = Toggly._telemetry?.captureCheck();
    return {
      recordCheck, flags: flags ?? Toggly.featureFlagsValue, variants: Toggly.variantsValue,
      localGates: Toggly._localGates, localGateIndex: Toggly._localGateIndex,
    };
  }

  static recordUsage(featureKey: string, variant = 'enabled'): void {
    Toggly._telemetry?.recordUsage(featureKey, variant);
  }

  static recordView(featureKey: string, variant = 'enabled'): void {
    Toggly._telemetry?.recordView(featureKey, variant);
  }

  static incrementCounter(metricKey: string, value = 1): void {
    Toggly._telemetry?.incrementCounter(metricKey, value);
  }

  static setGauge(metricKey: string, value: number): void {
    Toggly._telemetry?.setGauge(metricKey, value);
  }

  static flushTelemetry(): Promise<void> {
    return Toggly._telemetry?.flush() ?? Promise.resolve();
  }

  static get featureFlagsValue(): EvaluatedDefinitions {
    if (Toggly._inMemoryFlags) {
      return Toggly._inMemoryFlags;
    }

    const cachedFlags = Toggly._cachedFeatureFlags;
    if (Toggly._config?.appKey && cachedFlags) {
      Toggly._inMemoryFlags = cachedFlags;
      Toggly._hasLoadedFlags = true;
      return cachedFlags;
    }
    return Toggly._config?.flagDefaults ?? {};
  }

  private static readContextValue(key: string): string | null {
    if (canUseStorage && !Toggly._contextMemoryOnly.has(key)) {
      try {
        const value = localStorage.getItem(key);
        Toggly._contextMemory.set(key, value);
        return value;
      } catch { /* Fall back to the latest context snapshot. */ }
    }
    return Toggly._contextMemory.get(key) ?? null;
  }

  private static writeContextValue(key: string, value: string | null): void {
    Toggly._contextMemory.set(key, value);
    if (canUseStorage) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
        Toggly._contextMemoryOnly.delete(key);
        return;
      } catch { /* A failed write must not resurrect the previous stored value. */ }
    }
    Toggly._contextMemoryOnly.add(key);
  }

  static get identity(): string {
    return Toggly.readContextValue(StorageKeys.identityKey) ?? '';
  }

  static set identity(v: string) {
    const previous = Toggly._contextCacheKey;
    Toggly.writeContextValue(StorageKeys.identityKey, v);
    if (!v) Toggly._instanceId = '';
    Toggly.contextChanged(previous);
    Toggly.executeIdentifyHooks(v);
  }

  static clearIdentity() {
    const currentIdentity = Toggly.identity;
    const previous = Toggly._contextCacheKey;
    Toggly.writeContextValue(StorageKeys.identityKey, null);
    Toggly._instanceId = '';
    Toggly.contextChanged(previous);
    if (currentIdentity) Toggly.executeIdentifyHooks('');
  }

  private static executeIdentifyHooks(identity: string): void {
    const generation = Toggly._generation;
    const dataMapPromise = Toggly._hookExecutor.executeBeforeIdentify(identity);
    Promise.resolve(dataMapPromise).then(dataMap =>
      generation === Toggly._generation ? Toggly._hookExecutor.executeAfterIdentify(identity, dataMap) : undefined
    ).catch(err => console.error('[Toggly] Hook execution error:', err));
  }

  static get groups(): string[] {
    try {
      return JSON.parse(Toggly.readContextValue(StorageKeys.groupsKey) ?? '[]');
    } catch {
      return [];
    }
  }

  static set groups(values: string[]) {
    const previous = Toggly._contextCacheKey;
    Toggly.writeContextValue(StorageKeys.groupsKey, JSON.stringify(values ?? []));
    Toggly.contextChanged(previous);
  }

  static get claims(): Record<string, string> {
    try {
      return JSON.parse(Toggly.readContextValue(StorageKeys.claimsKey) ?? '{}');
    } catch {
      return {};
    }
  }

  static set claims(values: Record<string, string>) {
    const previous = Toggly._contextCacheKey;
    Toggly.writeContextValue(StorageKeys.claimsKey, JSON.stringify(values ?? {}));
    Toggly.contextChanged(previous);
  }

  /** Host-minted capability, held in memory. Empty falls back to the current identity. */
  static get instanceId(): string { return Toggly._instanceId; }

  static set instanceId(value: string) {
    const previous = Toggly._contextCacheKey;
    Toggly._instanceId = typeof value === 'string' ? value.trim() : '';
    Toggly.contextChanged(previous);
  }

  private static contextChanged(previous: string): void {
    if (!Toggly._active || previous === Toggly._contextCacheKey) return;
    Toggly._generation++;
    Toggly._requests.forEach(controller => controller.abort());
    Toggly._requests.clear();
    Toggly._inMemoryFlags = null;
    Toggly._inMemoryVariants = null;
    Toggly._hasLoadedFlags = false;
    Toggly._cachedDefinitionsRevision = null;
    Toggly._cachedRevisionContext = null;
    Toggly._pendingDefinitionsPin = null;
    Toggly.stopWebSocket();
    Toggly.startWebSocket();
    Toggly.startRefreshInterval();
    Toggly.updateTelemetryContext();
  }

  static get evaluationContext(): TogglyEvaluationContext {
    const identity = Toggly.identity || undefined;
    const groups = Toggly.groups;
    const claims = Toggly.claims;
    return {
      identity,
      groups: groups.length ? groups : undefined,
      claims: Object.keys(claims).length ? claims : undefined,
    };
  }

  static setContext(context: TogglyEvaluationContext): Promise<{ [key: string]: boolean }> {
    const previous = Toggly._contextCacheKey;
    const currentIdentity = Toggly.identity;
    // Apply the complete targeting snapshot before invalidating requests and transports.
    if (context.identity !== undefined) {
      Toggly.writeContextValue(StorageKeys.identityKey, context.identity || null);
      if (!context.identity) Toggly._instanceId = '';
    }
    if (context.groups !== undefined) {
      Toggly.writeContextValue(StorageKeys.groupsKey, JSON.stringify(context.groups ?? []));
    }
    if (context.claims !== undefined) {
      Toggly.writeContextValue(StorageKeys.claimsKey, JSON.stringify(context.claims ?? {}));
    }
    Toggly.contextChanged(previous);
    if (context.identity !== undefined && (context.identity || currentIdentity)) {
      Toggly.executeIdentifyHooks(context.identity || '');
    }
    return Toggly.refresh();
  }

  static clearContext(): Promise<{ [key: string]: boolean }> {
    return Toggly.setContext({ identity: '', groups: [], claims: {} });
  }

  private static buildEvaluatedUrl(mode: 'evaluated' | 'variants'): string {
    const path = mode === 'variants' ? 'evaluated-variants-signed' : 'evaluated-signed';
    const url = new URL(
      `${Toggly._config.baseURI}/${path}/${Toggly._config.appKey}/${Toggly._config.environment}`
    );
    if (Toggly._instanceId) url.searchParams.set('i', Toggly._instanceId);
    else appendEvaluationContext(url, Toggly.evaluationContext, mode);
    return url.toString();
  }

  private static async fetchJwks(forceRefresh = false, generation = Toggly._generation, signal?: AbortSignal): Promise<JwkSet> {
    if (!forceRefresh && Toggly._inMemoryJwks) {
      return Toggly._inMemoryJwks;
    }
    const response = await fetch(`${Toggly._config.baseURI}/.well-known/jwks`, {
      headers: Toggly.buildFetchHeaders(),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch JWKs: ${response.status} ${response.statusText}`);
    }
    const jwks = (await response.json()) as JwkSet;
    if (generation === Toggly._generation) Toggly._inMemoryJwks = jwks;
    return jwks;
  }

  /** Prefer text() for raw defs verification; fall back to json() for test doubles. */
  private static async readResponseBody(response: Response): Promise<string> {
    if (typeof response.text === 'function') {
      return response.text();
    }
    return JSON.stringify(await response.json());
  }

  /**
   * Parse evaluated-signed body. When verifySignatures is enabled, verify ES256
   * against the exact raw defs JSON (Web Crypto double-hash), matching Go/Node.
   */
  private static async parseEvaluatedSignedBody(bodyText: string, generation = Toggly._generation, signal?: AbortSignal): Promise<{
    defs: unknown;
  }> {
    const config = Toggly._config;
    if (!config.verifySignatures) {
      const payload = JSON.parse(bodyText) as { defs?: unknown };
      return { defs: payload?.defs ?? payload };
    }
    const { envelope, defsRaw } = parseSignedEnvelope(bodyText);
    const jwks = await Toggly.fetchJwks(false, generation, signal);
    await verifySignedDefinitions(
      defsRaw,
      {
        signature: envelope.signature,
        timestamp: envelope.timestamp,
        kid: envelope.kid,
      },
      jwks,
      config.allowedKeyIds,
      { maxSignatureAgeSeconds: config.maxSignatureAgeSeconds }
    );
    return { defs: parseDefinitionsFromRaw(defsRaw) };
  }

  private static get _cachedFeatureFlags(): EvaluatedDefinitions | null {
    if (!Toggly._persistCache) return null;
    try {
      const raw = localStorage.getItem(Toggly._flagsCacheKey);
      const parsed = JSON.parse(raw ?? 'null') as EvaluatedDefinitions | null;
      if (raw != null && parsed != null) {
        Toggly._touchCacheKey(Toggly._flagsCacheKey);
      }
      return parsed;
    } catch (error) {
      Toggly._reportError('Error reading cached feature flags', error);
      return null;
    }
  }

  static cacheFeatureFlags(flags: EvaluatedDefinitions) {
    Toggly._inMemoryFlags = flags;
    Toggly._hasLoadedFlags = true;
    if (!Toggly._persistCache) return;
    try {
      const key = Toggly._flagsCacheKey;
      localStorage.setItem(key, JSON.stringify(flags));
      Toggly._touchCacheKey(key);
      Toggly._enforceMaxCacheKeys([key, Toggly._variantsCacheKey]);
    } catch (error) {
      Toggly._reportError('Error writing feature flags cache', error);
    }
  }

  static clearFeatureFlagsCache() {
    Toggly._inMemoryFlags = null;
    Toggly._inMemoryVariants = null;
    Toggly._hasLoadedFlags = false;
    Toggly._cachedDefinitionsRevision = null;
    Toggly._cachedRevisionContext = null;
    if (!canUseStorage) return;
    try {
      const flagsKey = Toggly._flagsCacheKey;
      const variantsKey = Toggly._variantsCacheKey;
      localStorage.removeItem(flagsKey);
      localStorage.removeItem(variantsKey);
      localStorage.removeItem(Toggly._revisionCacheKey);
      Toggly._removeCacheKeysFromLruIndex([flagsKey, variantsKey]);
    } catch (error) {
      Toggly._reportError('Error clearing feature flags cache', error);
    }
  }

  static get variantsValue(): { [key: string]: EvaluatedVariantDef } | null {
    if (!Toggly._config?.enableVariants) return null;
    if (Toggly._inMemoryVariants) return Toggly._inMemoryVariants;
    if (Toggly._persistCache) {
      try {
        const raw = localStorage.getItem(Toggly._variantsCacheKey);
        const parsed = JSON.parse(raw ?? 'null') as { [key: string]: EvaluatedVariantDef } | null;
        if (raw != null && parsed != null) {
          Toggly._touchCacheKey(Toggly._variantsCacheKey);
          Toggly._inMemoryVariants = parsed;
        }
        return parsed;
      } catch { return null; }
    }
    return null;
  }

  static cacheVariants(variants: { [key: string]: EvaluatedVariantDef }) {
    Toggly._inMemoryVariants = variants;
    if (!Toggly._persistCache) return;
    try {
      const key = Toggly._variantsCacheKey;
      localStorage.setItem(key, JSON.stringify(variants));
      Toggly._touchCacheKey(key);
      Toggly._enforceMaxCacheKeys([Toggly._flagsCacheKey, key]);
    } catch (error) {
      Toggly._reportError('Error writing variants cache', error);
    }
  }

  private static _isTrackedCacheKey(key: string): boolean {
    return key.startsWith('toggly:flags:') || key.startsWith('toggly:variants:');
  }

  private static _loadLruIndex(): CacheLruIndex {
    try {
      return parseCacheLruIndex(localStorage.getItem(StorageKeys.cacheLruKey));
    } catch {
      return parseCacheLruIndex(null);
    }
  }

  private static _saveLruIndex(index: CacheLruIndex): void {
    try {
      localStorage.setItem(StorageKeys.cacheLruKey, serializeCacheLruIndex(index));
    } catch (error) {
      Toggly._reportError('Error writing cache LRU index', error);
    }
  }

  private static _touchCacheKey(key: string): void {
    if (!Toggly._persistCache || !isCacheLruEnabled(Toggly._config?.maxCacheKeys)) {
      return;
    }
    if (!Toggly._isTrackedCacheKey(key)) {
      return;
    }
    try {
      const index = touchCacheLruKey(Toggly._loadLruIndex(), key);
      Toggly._saveLruIndex(index);
    } catch (error) {
      Toggly._reportError('Error updating cache LRU index', error);
    }
  }

  private static _enforceMaxCacheKeys(protectKeys: string[]): void {
    const maxKeys = Toggly._config?.maxCacheKeys;
    if (!Toggly._persistCache || !isCacheLruEnabled(maxKeys)) {
      return;
    }
    try {
      let index = Toggly._loadLruIndex();
      const toEvict = selectCacheLruKeysToEvict(index, maxKeys as number, { protectKeys }).filter(
        (key) => Toggly._isTrackedCacheKey(key),
      );
      if (toEvict.length === 0) {
        return;
      }
      for (const key of toEvict) {
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore per-key removal failures */
        }
      }
      index = removeCacheLruKeys(index, toEvict);
      Toggly._saveLruIndex(index);
    } catch (error) {
      Toggly._reportError('Error enforcing cache LRU limit', error);
    }
  }

  private static _removeCacheKeysFromLruIndex(keys: string[]): void {
    if (!Toggly._persistCache || !isCacheLruEnabled(Toggly._config?.maxCacheKeys)) {
      return;
    }
    try {
      const index = removeCacheLruKeys(Toggly._loadLruIndex(), keys);
      Toggly._saveLruIndex(index);
    } catch (error) {
      Toggly._reportError('Error updating cache LRU index', error);
    }
  }

  /**
   * Get the assigned variant for a feature flag.
   * Returns null if no variant is assigned or variants are not enabled.
   */
  static getVariant(featureKey: string): VariantResult | null {
    const evaluation = Toggly.captureEvaluation();
    const entry = evaluation.variants?.[featureKey];
    const enabled = Toggly._getEffectiveFlagValue(evaluation.flags, featureKey, undefined, evaluation);
    if (!entry || !entry.variant) return null;
    if (!enabled || entry.enabled !== true) {
      return null;
    }
    return {
      name: entry.variant,
      configurationValue: entry.configurationValue,
    };
  }

  /**
   * Get the configuration value of the assigned variant for a feature flag.
   * Returns null if no variant is assigned or no configuration value is set.
   */
  static getVariantValue(featureKey: string): unknown | null {
    const variant = Toggly.getVariant(featureKey);
    return variant?.configurationValue ?? null;
  }

  static fetchFeatureFlags(): Promise<{ [key: string]: boolean }> {
    if (Toggly._config.enableVariants) {
      return Toggly.fetchFeatureFlagsWithVariants();
    }

    const generation = Toggly._generation;
    const fallback = toBooleanDefinitions(Toggly._getFallbackFlags());
    const controller = new AbortController();
    Toggly._requests.add(controller);
    return new Promise((resolve) => {
      const { url, headers } = Toggly.consumePendingDefinitionsRequest('evaluated');

      // Wrap the fetch invocation in a resolved Promise so that any synchronous
      // failure (e.g. a non-conforming fetch implementation returning undefined)
      // is funneled through the same .catch handler as a real network error.
      Promise.resolve()
        .then(() => generation === Toggly._generation ? fetch(url, { headers, signal: controller.signal }) : null)
        .then((response) => {
          if (generation !== Toggly._generation) { resolve(fallback); return null; }
          Toggly.applyFetchRevision(response);
          if (response.status === 304) {
            const flags = Toggly._getFallbackFlags();
            Toggly._inMemoryFlags = flags;
            Toggly._hasLoadedFlags = true;
            resolve(toBooleanDefinitions(flags));
            return null;
          }
          if (!response.ok) {
            throw new Error(`Failed to fetch feature flags: ${response.status} ${response.statusText}`);
          }
          return Toggly.readResponseBody(response);
        })
        .then(async (bodyText) => {
          if (generation !== Toggly._generation) { resolve(fallback); return; }
          if (!bodyText) {
            const flags = Toggly._getFallbackFlags();
            resolve(toBooleanDefinitions(flags));
            return;
          }
          const { defs } = await Toggly.parseEvaluatedSignedBody(bodyText, generation, controller.signal);
          if (generation !== Toggly._generation) { resolve(fallback); return; }
          const flags = (defs && typeof defs === 'object' ? defs : {}) as EvaluatedDefinitions;
          Toggly.cacheFeatureFlags(flags);
          resolve(toBooleanDefinitions(flags));

          if (Toggly._config.isDebug) { console.log(`Toggly.fetchFeatureFlags - ${JSON.stringify(flags)}`); }
        })
        .catch((error) => {
          if (generation !== Toggly._generation) { resolve(fallback); return; }
          Toggly._reportError('Error fetching feature flags', error);
          var flags = Toggly._getFallbackFlags();
          resolve(toBooleanDefinitions(flags));

          if (Toggly._config.isDebug) { console.log(`Toggly.loadedFromCache - ${JSON.stringify(flags)}`); }
        }).finally(() => Toggly._requests.delete(controller));
    });
  }

  private static fetchFeatureFlagsWithVariants(): Promise<{ [key: string]: boolean }> {
    const generation = Toggly._generation;
    const fallback = toBooleanDefinitions(Toggly._getFallbackFlags());
    const controller = new AbortController();
    Toggly._requests.add(controller);
    return new Promise((resolve) => {
      const { url, headers } = Toggly.consumePendingDefinitionsRequest('variants');

      Promise.resolve()
        .then(() => generation === Toggly._generation ? fetch(url, { headers, signal: controller.signal }) : null)
        .then((response) => {
          if (generation !== Toggly._generation) { resolve(fallback); return null; }
          Toggly.applyFetchRevision(response);
          if (response.status === 304) {
            const flags = Toggly._getFallbackFlags();
            Toggly._inMemoryFlags = flags;
            Toggly._hasLoadedFlags = true;
            resolve(toBooleanDefinitions(flags));
            return null;
          }
          if (!response.ok) {
            throw new Error(`Failed to fetch feature flags: ${response.status} ${response.statusText}`);
          }
          return Toggly.readResponseBody(response);
        })
        .then(async (bodyText) => {
          if (generation !== Toggly._generation) { resolve(fallback); return; }
          if (!bodyText) {
            const flags = Toggly._getFallbackFlags();
            resolve(toBooleanDefinitions(flags));
            return;
          }
          const { defs: rawDefs } = await Toggly.parseEvaluatedSignedBody(bodyText, generation, controller.signal);
          if (generation !== Toggly._generation) { resolve(fallback); return; }
          const defs: { [key: string]: EvaluatedVariantDef } =
            rawDefs && typeof rawDefs === 'object' && !Array.isArray(rawDefs)
              ? (rawDefs as { [key: string]: EvaluatedVariantDef })
              : {};
          Toggly.cacheVariants(defs);

          const boolFlags: { [key: string]: boolean } = {};
          for (const [key, entry] of Object.entries(defs)) {
            boolFlags[key] = entry.enabled;
          }
          Toggly.cacheFeatureFlags(boolFlags);
          resolve(boolFlags);

          if (Toggly._config.isDebug) { console.log(`Toggly.fetchFeatureFlagsWithVariants - ${JSON.stringify(defs)}`); }
        })
        .catch((error) => {
          if (generation !== Toggly._generation) { resolve(fallback); return; }
          Toggly._reportError('Error fetching feature flags', error);
          const flags = Toggly._getFallbackFlags();
          resolve(toBooleanDefinitions(flags));

          if (Toggly._config.isDebug) { console.log(`Toggly.loadedFromCache - ${JSON.stringify(flags)}`); }
        }).finally(() => Toggly._requests.delete(controller));
    });
  }

  static refresh(): Promise<{ [key: string]: boolean }> {
    const generation = Toggly._generation;
    if (Toggly._config.isDebug) { console.log('Toggly.refresh'); }

    if (!Toggly._config.appKey) {
      if (Toggly._config.isDebug) { console.log(`Toggly.usedFlagDefaults - ${JSON.stringify(Toggly._config.flagDefaults)}`); }

      const flags = Toggly._config.flagDefaults;
      Toggly._inMemoryFlags = flags;
      Promise.resolve(Toggly._hookExecutor.executeAfterRefresh(flags))
        .catch(err => console.error('[Toggly] Hook execution error:', err));
      
      return new Promise((resolve, reject) => {
        resolve(flags);
      });
    }

    return Toggly.fetchFeatureFlags().then(flags => {
      if (generation !== Toggly._generation) return flags;
      Promise.resolve(Toggly._hookExecutor.executeAfterRefresh(flags))
        .catch(err => console.error('[Toggly] Hook execution error:', err));
      return flags;
    });
  }

  private static _getEffectiveFlagValue(
    flags: EvaluatedDefinitions,
    flagKey: string,
    entityContext?: TogglyEntityContext | null,
    evaluation = Toggly.captureEvaluation(flags),
  ): boolean {
    const assigned = evaluation.variants?.[flagKey];
    const remote = resolveEvaluatedDefinition(flags[flagKey], entityContext);
    const enabled = applyLocalGate(remote, flagKey, evaluation.localGates, evaluation.localGateIndex);
    try {
      evaluation.recordCheck?.(flagKey, (enabled && assigned?.enabled === true && assigned.variant) || (enabled ? 'enabled' : 'disabled'));
    } catch { /* Telemetry must never change feature evaluation. */ }
    return enabled;
  }

  private static _evaluateFeatureGate(
    flags: EvaluatedDefinitions = {},
    featureGate: string[],
    requirement: FeatureRequirement = FeatureRequirement.all,
    negate: boolean = false,
    entityContext?: TogglyEntityContext | null,
    evaluation = Toggly.captureEvaluation(flags),
  ) {
    if (featureGate.length > 0 && Object.keys(flags).length === 0) {
      return negate;
    }

    var isEnabled: boolean;

    if (requirement === FeatureRequirement.any) {
      isEnabled = featureGate.reduce((isEnabled, featureKey) => {
        return isEnabled ||
          Toggly._getEffectiveFlagValue(flags, featureKey, entityContext, evaluation);
      }, false);
    } else {
      isEnabled = featureGate.reduce((isEnabled, featureKey) => {
        return isEnabled &&
          Toggly._getEffectiveFlagValue(flags, featureKey, entityContext, evaluation);
      }, true);
    }

    if (Toggly._config.isDebug) { console.log(`Toggly._evaluateFeatureGate - ${JSON.stringify(featureGate)}`); }

    isEnabled = negate ? !isEnabled : isEnabled;

    return isEnabled;
  }

  static evaluateFeatureGate(
    featureGate: string[],
    requirement: FeatureRequirement = FeatureRequirement.all,
    negate: boolean = false,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): boolean {
    const generation = Toggly._generation;
    const evaluation = Toggly.captureEvaluation();
    const entityContext = normalizeEntityContext(context, kind);
    if (featureGate.length === 0) {
      return Toggly._evaluateFeatureGate(evaluation.flags, featureGate, requirement, negate, entityContext, evaluation);
    }
    
    const firstKey = featureGate[0];
    const dataMapPromise = Toggly._hookExecutor.executeBeforeEvaluation(firstKey);
    const result = Toggly._evaluateFeatureGate(evaluation.flags, featureGate, requirement, negate, entityContext, evaluation);
    Promise.resolve(dataMapPromise).then(dataMap =>
      generation === Toggly._generation ? Toggly._hookExecutor.executeAfterEvaluation(firstKey, dataMap, result) : undefined
    ).catch(err => console.error('[Toggly] Hook execution error:', err));
    
    return result;
  }

  static isFeatureOn(
    featureKey: string,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): boolean {
    const generation = Toggly._generation;
    const evaluation = Toggly.captureEvaluation();
    const entityContext = normalizeEntityContext(context, kind);
    const dataMapPromise = Toggly._hookExecutor.executeBeforeEvaluation(featureKey);
    const result = Toggly._evaluateFeatureGate(evaluation.flags, [featureKey], FeatureRequirement.all, false, entityContext, evaluation);
    Promise.resolve(dataMapPromise).then(dataMap => 
      generation === Toggly._generation ? Toggly._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result) : undefined
    ).catch(err => console.error('[Toggly] Hook execution error:', err));
    return result;
  }

  static registerContext<T>(kind: string, mapper: (entity: T) => TogglyEntityContext): void {
    registerEntityContext(kind, mapper);
  }

  static isFeatureOff(featureKey: string): boolean {
    const generation = Toggly._generation;
    const evaluation = Toggly.captureEvaluation();
    const dataMapPromise = Toggly._hookExecutor.executeBeforeEvaluation(featureKey);
    const result = Toggly._evaluateFeatureGate(evaluation.flags, [featureKey], FeatureRequirement.all, true, undefined, evaluation);
    Promise.resolve(dataMapPromise).then(dataMap => 
      generation === Toggly._generation ? Toggly._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result) : undefined
    ).catch(err => console.error('[Toggly] Hook execution error:', err));
    return result;
  }

  /**
   * Add a hook dynamically
   */
  static addHook(hook: Hook): void {
    Toggly._hookExecutor.addHook(hook);
  }

  /**
   * Remove a hook by name
   * @returns true if hook was found and removed, false otherwise
   */
  static removeHook(name: string): boolean {
    return Toggly._hookExecutor.removeHook(name);
  }

  /**
   * Register device-local gates applied as a read-time AND on worker booleans.
   */
  static setLocalGates(gates: LocalGate[]): void {
    Toggly._localGates = [...gates];
    Toggly._localGateIndex = buildFlagGateIndex(Toggly._localGates);
  }

  /**
   * Notify subscribers that local gate state changed (no network fetch).
   */
  static notifyLocalGatesChanged(): void {
    Toggly._localGatesChangedListeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('[Toggly] Local gate listener error:', err);
      }
    });
  }

  /**
   * Subscribe to local gate changes. Returns an unsubscribe function.
   */
  static subscribeLocalGatesChanged(listener: () => void): () => void {
    Toggly._localGatesChangedListeners.add(listener);
    return () => {
      Toggly._localGatesChangedListeners.delete(listener);
    };
  }

  static startWebSocket() {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    if (!Toggly._config.appKey) {
      return;
    }

    if (Toggly._config.enableLiveUpdates === false) {
      return;
    }

    Toggly.stopWebSocket();

    const wsUrl = buildWebSocketUrl(
      Toggly._config.baseURI,
      Toggly._config.appKey,
      Toggly.definitionsRevision,
    );

    if (Toggly._config.isDebug) { console.log(`[Toggly] WebSocket connecting to ${wsUrl}`); }

    const generation = Toggly._generation;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (generation !== Toggly._generation || Toggly._ws !== ws) return;
      Toggly._wsConnected = true;
      Toggly._wsReconnectAttempt = 0;
      Toggly._lastFallbackRefresh = Date.now();
      if (Toggly._config.isDebug) { console.log('[Toggly] WebSocket connected'); }
    };

    ws.onmessage = (event) => {
      if (generation !== Toggly._generation || Toggly._ws !== ws) return;
      const data = event.data;

      if (typeof data === 'string') {
        if (data === 'update' || data === 'flags-updated') {
          if (Toggly._config.isDebug) { console.log(`[Toggly] WebSocket received text: ${data}`); }
          Toggly.scheduleDebouncedRefresh();
          return;
        }

        try {
          const message = JSON.parse(data) as WsSyncMessage;
          if (message.type === 'ping') {
            return;
          }
          if (message.type === 'sync') {
            if (Toggly._config.isDebug) { console.log('[Toggly] WebSocket received sync'); }
            Toggly.handleWsSyncMessage(message);
            return;
          }
          if (message.type === 'flags-updated' || message.type === 'update' || message.type === 'signing-key-updated') {
            if (Toggly._config.isDebug) { console.log(`[Toggly] WebSocket received: ${message.type}`); }
            Toggly.handleWsUpdateMessage(message);
          }
        } catch (e) {
          if (Toggly._config.isDebug) { console.log(`[Toggly] WebSocket received unrecognized message: ${data}`); }
        }
      }
    };

    ws.onclose = () => {
      if (generation !== Toggly._generation || Toggly._ws !== ws) return;
      Toggly._wsConnected = false;
      Toggly._ws = null;
      const delay = getNextReconnectDelayMs(Toggly._wsReconnectAttempt);
      Toggly._wsReconnectAttempt += 1;
      if (Toggly._config.isDebug) { console.log(`[Toggly] WebSocket closed, reconnecting in ${delay}ms`); }

      Toggly._wsReconnectTimer = setTimeout(() => {
        if (generation !== Toggly._generation) return;
        Toggly.startWebSocket();
      }, delay);
    };

    ws.onerror = (error) => {
      if (generation !== Toggly._generation || Toggly._ws !== ws) return;
      console.error('[Toggly] WebSocket error:', error);
    };

    Toggly._ws = ws;
  }

  static stopWebSocket() {
    if (Toggly._wsReconnectTimer) {
      clearTimeout(Toggly._wsReconnectTimer);
      Toggly._wsReconnectTimer = null;
    }

    if (Toggly._refreshDebounceTimer) {
      clearTimeout(Toggly._refreshDebounceTimer);
      Toggly._refreshDebounceTimer = null;
    }

    if (Toggly._ws) {
      Toggly._ws.onopen = null;
      Toggly._ws.onmessage = null;
      Toggly._ws.onclose = null;
      Toggly._ws.onerror = null;
      Toggly._ws.close();
      Toggly._ws = null;
    }

    Toggly._wsConnected = false;
  }

  private static stopDefinitionResources(): void {
    Toggly._active = false;
    Toggly._generation++;
    Toggly._requests.forEach(controller => controller.abort());
    Toggly._requests.clear();
    if (typeof window !== 'undefined') window.clearInterval(Toggly._refreshInterval);
    Toggly._refreshInterval = undefined;
    Toggly.stopWebSocket();
  }

  static cancelRefreshInterval() {
    Toggly.stopDefinitionResources();
    Toggly.stopTelemetry();
  }

  static startRefreshInterval() {
    if (typeof window !== 'undefined') window.clearInterval(Toggly._refreshInterval);
    Toggly._refreshInterval = undefined;
    const generation = Toggly._generation;

    if (typeof window !== 'undefined' && Toggly._config.appKey && Toggly._config.featureFlagsRefreshInterval > 0) {
      Toggly._refreshInterval = window.setInterval(() => {
        if (generation !== Toggly._generation) return;
        if (Toggly._wsConnected && (Date.now() - Toggly._lastFallbackRefresh) < Toggly._fallbackRefreshInterval) {
          if (Toggly._config.isDebug) { console.log('[Toggly] Skipping interval refresh, WebSocket is connected'); }
          return;
        }

        Toggly._lastFallbackRefresh = Date.now();
        Toggly.refresh();
      }, Toggly._config.featureFlagsRefreshInterval);
    }
  }
}

if (typeof window !== 'undefined') {
  (window as any).Toggly = Toggly;
}
