import { createTelemetryReporter, type TelemetryReporter } from '@ops-ai/toggly-client-telemetry';
import type { CacheLruIndex, Hook, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import {
  appendEvaluationContext,
  isCacheLruEnabled,
  normalizeEntityContext,
  parseCacheLruIndex,
  registerContext as registerEntityContext,
  removeCacheLruKeys,
  resolveEvaluatedDefinition,
  selectCacheLruKeysToEvict,
  serializeCacheLruIndex,
  toBooleanDefinitions,
  touchCacheLruKey,
  type TogglyEntityContext,
} from '@ops-ai/toggly-hooks-types';
import {
  applyLocalGate,
  buildFlagGateIndex,
  type FlagGateIndex,
  type LocalGate,
} from '@ops-ai/toggly-local-gates';
import type {
  TogglyConfig,
  FeatureFlags,
  FeatureRequirement,
  TogglyStorage,
  TogglyLoadStatus,
  TogglyInitResponse,
  TogglyDebugInfo,
  NetworkState,
  AppStateType,
  TogglyFeatureFlagsCache,
  FeatureStateChangeHandler,
  TogglyEventListener,
  TogglyEventType,
  EvaluatedVariantDef,
  VariantResult,
} from '../models';
import { HookExecutor } from './HookExecutor';
import { decodeVariantValue } from '../decode-variant-value';
import { EventEmitter } from './EventEmitter';
import { MemoryStorage } from './MemoryStorage';
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
} from '../ws-sync';
import { buildDefinitionFetchHeaders } from '../sdk-identity';
import {
  parseDefinitionsFromRaw,
  parseSignedEnvelope,
  verifySignedDefinitions as verifySignedEnvelope,
  type JwkSet,
} from '../crypto/signedDefsVerify';
import { asVariantDefsRecord } from '@ops-ai/toggly-signed-defs';

/**
 * Storage keys used by Toggly
 */
const STORAGE_KEYS = {
  DEVICE_ID: '@toggly:deviceId',
  FEATURE_FLAGS_CACHE: '@toggly:featureFlagsCache:',
  ETAG: '@toggly:etag',
  JWKS: '@toggly:jwks',
  CACHE_LRU: '@toggly:cache-lru',
} as const;

// Only in-flight cache mutations are retained. Later writes may finish without
// waiting for a retired storage operation; that operation repairs the latest value
// if its eventual completion overwrites it. Owners sharing storage share this fence.
const pendingCacheMutations = new WeakMap<TogglyStorage, Map<string, {
  desired: { value: string | null }; pending: number;
}>>();

async function mutateCache(storage: TogglyStorage, key: string, value: string | null): Promise<void> {
  let mutations = pendingCacheMutations.get(storage);
  if (!mutations) { mutations = new Map(); pendingCacheMutations.set(storage, mutations); }
  const desired = { value };
  let state = mutations.get(key);
  if (!state) { state = { desired, pending: 0 }; mutations.set(key, state); }
  state.desired = desired;
  state.pending++;
  let applied = desired;
  const write = async () => applied.value === null ? storage.delete(key) : storage.set(key, applied.value);
  try {
    try { await write(); }
    finally {
      // Repair even when a storage provider mutates and then rejects its promise.
      while (applied !== state.desired) { applied = state.desired; await write(); }
    }
  } finally {
    state.pending--;
    if (state.pending === 0) mutations.delete(key);
  }
}

type CachedBody = TogglyFeatureFlagsCache & { writeId?: string; variants?: string };
type CachedRevision = { context: string; revision: string; writeId?: string };

/** Project raw evaluated-variants defs onto the boolean flags shape used for gate evaluation. */
function variantDefsToFlags(defs: Record<string, EvaluatedVariantDef>): FeatureFlags {
  const out: FeatureFlags = {};
  for (const key of Object.keys(defs)) {
    out[key] = defs[key]?.enabled === true;
  }
  return out;
}

/**
 * Fallback polling interval when WebSocket is connected (20 minutes)
 */
const FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000;

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<
  Pick<
    TogglyConfig,
    | 'baseURI'
    | 'environment'
    | 'showFeatureDuringEvaluation'
    | 'refreshInterval'
    | 'useSignedDefinitions'
    | 'verifySignatures'
    | 'connectTimeout'
    | 'requestTimeout'
    | 'enableLiveUpdates'
  >
> = {
  baseURI: 'https://definitions.toggly.io',
  environment: 'Production',
  showFeatureDuringEvaluation: false,
  refreshInterval: 180000, // 3 minutes
  useSignedDefinitions: false,
  verifySignatures: false,
  connectTimeout: 10000,
  requestTimeout: 30000,
  enableLiveUpdates: false,
};

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Simple SHA-256 hash function (for identity hashing)
 * Uses a basic implementation since we can't rely on crypto APIs in React Native
 */
async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);

  // Try to use crypto.subtle if available (React Native Hermes with polyfill)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fall through to simple hash
    }
  }

  // Simple hash fallback for environments without crypto.subtle
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Core Toggly service for React Native.
 * Provides feature flag evaluation, caching, and lifecycle management.
 */
export class TogglyService {
  private config: Required<
    Pick<
      TogglyConfig,
      | 'baseURI'
      | 'environment'
      | 'showFeatureDuringEvaluation'
      | 'refreshInterval'
      | 'useSignedDefinitions'
      | 'connectTimeout'
      | 'requestTimeout'
      | 'enableLiveUpdates'
    >
  > &
    TogglyConfig;

  private storage: TogglyStorage;
  private hookExecutor: HookExecutor;
  private eventEmitter: EventEmitter;

  private features: FeatureFlags | null = null;
  /** Raw evaluated-variants defs when {@link TogglyConfig.enableVariants} is set; null otherwise. */
  private variants: Record<string, EvaluatedVariantDef> | null = null;
  private featuresLoading = false;
  /** Serializes LRU index read-modify-write to avoid lost updates. */
  private lruMutationChain: Promise<void> = Promise.resolve();
  private identity: string | null = null;
  private instanceId: string | undefined;
  private generation = 0;
  private contextIntent = 0;
  private refreshOperation = 0;
  private groups: string[] = [];
  private claims: Record<string, string> = {};
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastChecked: Date | null = null;
  private lastSynced: Date | null = null;
  private lastError: string | null = null;
  private cachedDefinitionsRevision: string | null = null;
  private pendingDefinitionsPin: string | null = null;
  private isInitialized = false;
  private initialization: Promise<TogglyInitResponse> | null = null;
  private disposed = false;
  private readonly telemetry: TelemetryReporter;
  private activeRequest?: AbortController;
  private requestTimer?: ReturnType<typeof setTimeout>;
  private networkState: NetworkState | null = null;
  private appState: AppStateType = 'active';
  private stateChangeHandlers: Set<FeatureStateChangeHandler> = new Set();
  private networkUnsubscribe: (() => void) | null = null;
  private appStateUnsubscribe: (() => void) | null = null;

  // WebSocket live-update state
  private _ws: WebSocket | null = null;
  private _wsConnected = false;
  private _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _wsReconnectAttempt = 0;
  private _refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastFallbackRefresh = 0;

  private localGates: LocalGate[] = [];
  private localGateIndex: FlagGateIndex = new Map();

  /**
   * Whether to show feature content during initial evaluation
   */
  get shouldShowFeatureDuringEvaluation(): boolean {
    return this.config.showFeatureDuringEvaluation;
  }

  /**
   * Whether the SDK has been initialized
   */
  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Current user identity
   */
  get currentIdentity(): string | null {
    return this.identity;
  }

  /**
   * Current feature flags (may be null if not loaded)
   */
  get currentFeatures(): FeatureFlags | null {
    return this.features ? { ...this.features } : null;
  }

  private reportError(message: string, error: unknown, isCurrent: () => boolean = () => !this.disposed): void {
    if (!isCurrent()) return;
    this.lastError = error instanceof Error ? error.message : message;
    try {
      void Promise.resolve(this.config.onError?.(error instanceof Error ? error : new Error(message))).catch(() => {});
    } catch { /* Observers cannot interrupt recovery or owner cleanup. */ }
    if (isCurrent()) this.eventEmitter.emit('error', { error: this.lastError }, isCurrent);
  }

  private emitEffectiveFlagsChanged(flags: FeatureFlags = this.features ?? {}, isCurrent: () => boolean = () => !this.disposed): void {
    if (isCurrent()) this.eventEmitter.emit('effectiveFlagsChanged', flags, isCurrent);
  }

  private getDefinitionsRevision(): string | null {
    if (this.cachedDefinitionsRevision) {
      return this.cachedDefinitionsRevision;
    }
    return null;
  }

  private decodeCachedFlags(raw: string | null, context: string): FeatureFlags | undefined {
    if (!raw) return undefined;
    const record = JSON.parse(raw) as CachedBody;
    if (record.identity !== context || typeof record.flags !== 'string') return undefined;
    const flags = JSON.parse(record.flags) as unknown;
    if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return undefined;
    const valid = Object.values(flags).every(value => {
      if (typeof value === 'boolean') return true;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const gate = value as {requirement?: unknown; rules?: unknown};
      return (gate.requirement === 'all' || gate.requirement === 'any') && Array.isArray(gate.rules) && gate.rules.every(rule =>
        rule && typeof rule === 'object' && typeof rule.property === 'string' && typeof rule.op === 'string' && typeof rule.value === 'string' &&
        (rule.type === undefined || ['datetime','number','boolean','string','string[]'].includes(rule.type)));
    });
    return valid ? flags as FeatureFlags : undefined;
  }

  /** Decode the paired variant-defs body written alongside a variants-mode flags cache entry. */
  private decodeCachedVariants(body: CachedBody | null, context: string): Record<string, EvaluatedVariantDef> | null {
    if (!body || body.identity !== context || typeof body.variants !== 'string') return null;
    try {
      const parsed = JSON.parse(body.variants) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const valid = Object.values(parsed).every(value =>
        !!value && typeof value === 'object' && typeof (value as EvaluatedVariantDef).enabled === 'boolean');
      return valid ? parsed as Record<string, EvaluatedVariantDef> : null;
    } catch {
      return null;
    }
  }

  private async loadCachedDefinitionsRevision(): Promise<void> {
    if (this.cachedDefinitionsRevision) return;
    const context = this.getContextCacheKey();
    const generation = this.generation;
    const current = () => !this.disposed && generation === this.generation;
    try {
      const stored = await this.storage.get(STORAGE_KEYS.ETAG);
      if (!current() || !stored?.startsWith('{')) return;
      const record = JSON.parse(stored) as CachedRevision;
      if (record.context !== context || typeof record.revision !== 'string') return;
      const key = await this.buildFeatureFlagsCacheKey(context);
      if (!current()) return;
      const raw = await this.storage.get(key);
      const flags = this.decodeCachedFlags(raw, context);
      const body = raw ? JSON.parse(raw) as CachedBody : null;
      if (!current() || !flags || !record.writeId || record.writeId !== body?.writeId) return;
      this.features = flags;
      if (this.config.enableVariants) this.variants = this.decodeCachedVariants(body, context);
      this.cachedDefinitionsRevision = record.revision;
    } catch (error) {
      if (current()) this.reportError('Error reading definitions revision cache', error);
    }
  }

  private async cacheDefinitionsRevision(revision: string | null | undefined): Promise<void> {
    if (this.disposed || !revision) return;
    const normalized = revision.replace(/^"+|"+$/g, '');
    const context = this.getContextCacheKey();
    const generation = this.generation;
    const operation = this.refreshOperation;
    const current = () => !this.disposed && generation === this.generation && operation === this.refreshOperation;
    const flags = JSON.stringify(this.features);
    this.cachedDefinitionsRevision = normalized;
    try {
      const key = await this.buildFeatureFlagsCacheKey(context);
      if (!current()) return;
      const raw = await this.storage.get(key);
      const body = this.decodeCachedFlags(raw, context);
      const writeId = raw ? (JSON.parse(raw) as CachedBody).writeId : undefined;
      if (!current() || !body || !writeId || JSON.stringify(body) !== flags) return;
      await mutateCache(this.storage, STORAGE_KEYS.ETAG, JSON.stringify({context, revision: normalized, writeId}));
    } catch (error) {
      if (current()) this.reportError('Error writing definitions revision cache', error);
    }
  }

  private scheduleDebouncedRefresh(forceRevisionReset = false): void {
    if (this.disposed) return;
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
    }
    this._refreshDebounceTimer = setTimeout(() => {
      this._refreshDebounceTimer = null;
      const run = async () => {
        if (this.disposed) return;
        if (forceRevisionReset) {
          this.cachedDefinitionsRevision = null;
          // Await deletes so refresh cannot rehydrate retired signing keys.
          await mutateCache(this.storage, STORAGE_KEYS.ETAG, null);
          if (this.disposed) return;
          await this.storage.delete(STORAGE_KEYS.JWKS);
        }
        await this.refresh();
      };
      void run();
    }, REFRESH_DEBOUNCE_MS);
  }

  private handleWsSyncMessage(message: WsSyncMessage): void {
    const previousRevision = this.getDefinitionsRevision();
    if (shouldFetchOnSync(message, previousRevision)) {
      // Do not cache WS etag before HTTP confirms — avoids conditional 304 with stale defs.
      this.scheduleDebouncedRefresh();
      return;
    }
    if (message.etag) {
      void this.cacheDefinitionsRevision(message.etag);
    }
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
        cacheEtagIfPresent: (etag) => {
          void this.cacheDefinitionsRevision(etag);
        },
      },
    );
  }

  constructor(config: TogglyConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Install targeting before reporter construction can call a host diagnostic.
    this.identity = config.identity || null;
    this.instanceId = config.instanceId?.trim() || undefined;
    this.telemetry = createTelemetryReporter({
      appKey: config.appKey, environment: config.environment,
      identity: this.identity ?? undefined, instanceId: this.instanceId,
      enableTelemetry: config.enableTelemetry, metricsBaseUrl: config.metricsBaseUrl,
      telemetryFlushIntervalMs: config.telemetryFlushIntervalMs,
      onDiagnostic: config.onTelemetryDiagnostic,
    });
    // Snapshot startup targeting before native subscriptions or asynchronous storage.
    this.groups = [...(config.groups ?? [])];
    this.claims = { ...(config.claims ?? {}) };
    this.storage = config.storage ?? new MemoryStorage();
    this.hookExecutor = new HookExecutor();
    this.eventEmitter = new EventEmitter();

    // Register initial hooks
    if (config.hooks) {
      config.hooks.forEach((hook) => this.hookExecutor.addHook(hook));
    }

    if (config.localGates) {
      this.setLocalGates(config.localGates);
    }

    // Setup network info listener
    if (config.networkInfo) {
      this.networkUnsubscribe = config.networkInfo.subscribe((state) => {
        if (this.disposed) return;
        const wasOffline = this.networkState?.isConnected === false;
        this.networkState = state;
        this.eventEmitter.emit('networkChanged', state);

        // Refresh when coming back online
        if (this.isInitialized && !this.disposed && wasOffline && state.isConnected) {
          this.refresh();
        }
      });

      // Get initial network state
      config.networkInfo.getState().then((state) => {
        if (!this.disposed) this.networkState = state;
      }).catch(() => { /* Connectivity lookup cannot revive or fail an owner. */ });
    }

    // Setup app state listener
    if (config.appState) {
      this.appState = config.appState.getCurrentState();
      this.appStateUnsubscribe = config.appState.subscribe((state) => {
        if (this.disposed) return;
        if (state === 'background' || state === 'inactive') void this.flushTelemetry();
        const wasBackground = this.appState === 'background';
        this.appState = state;
        this.eventEmitter.emit('appStateChanged', state);

        // Refresh when coming to foreground
        if (this.isInitialized && !this.disposed && wasBackground && state === 'active') {
          this.refresh();
        }
      });
    }
  }

  /**
   * Initialize Toggly and load feature flags.
   * @returns Promise resolving to the initialization response
   */
  async init(): Promise<TogglyInitResponse> {
    if (this.disposed) return this.retiredResponse();
    if (this.initialization) return this.initialization;
    const pending = this.initialize();
    this.initialization = pending;
    try {
      return await pending;
    } finally {
      if (this.initialization === pending) this.initialization = null;
    }
  }

  private async initialize(): Promise<TogglyInitResponse> {
    const expected = this.generation;
    const current = () => !this.disposed && expected === this.generation;
    // A setter may already own identity before asynchronous initialization.
    if (!this.identity) {
      // Try to get stored device ID
      let storedId = await this.storage.get(STORAGE_KEYS.DEVICE_ID);
      if (!current()) return this.retiredResponse();
      if (!storedId) {
        storedId = generateUUID();
        await this.storage.set(STORAGE_KEYS.DEVICE_ID, storedId);
      }
      if (!current()) return this.retiredResponse();
      this.identity = storedId;
    }

    this.telemetry.setContext({ instanceId: this.instanceId, identity: this.identity ?? undefined });
    if (!current()) return this.retiredResponse();

    // Load cached definitions revision for conditional HTTP requests
    await this.loadCachedDefinitionsRevision();
    if (!current()) return this.retiredResponse();

    // Perform initial refresh
    const response = await this.performRefresh();

    if (!current()) return response;
    this.isInitialized = true;
    this.startRefreshTimer();
    this.eventEmitter.emit('initialized', response, current);
    if (!current()) return this.retiredResponse();

    // Start WebSocket live updates after successful initialization
    if (this.config.enableLiveUpdates) {
      this.startWebSocket();
    }

    return response;
  }

  /**
   * Refresh feature flags from the server or cache.
   * @returns Promise resolving to the refresh response
   */
  async refresh(): Promise<TogglyInitResponse> {
    // Initialization owns the first request; concurrent callers share its result.
    if (this.initialization) return this.initialization;
    if (!this.isInitialized || this.disposed) {
      return { status: 'cached' as TogglyLoadStatus, flags: this.features ?? this.config.featureDefaults };
    }
    return this.performRefresh();
  }

  private async performRefresh(): Promise<TogglyInitResponse> {
    if (this.disposed) return { status: 'cached' as TogglyLoadStatus, flags: this.config.featureDefaults };
    // Skip refresh if app is not in foreground
    if (this.appState !== 'active') {
      return {
        status: 'cached' as TogglyLoadStatus,
        flags: this.features ?? this.config.featureDefaults,
      };
    }

    // Skip refresh if offline
    if (this.networkState?.isConnected === false) {
      const generation = this.generation;
      const operation = this.refreshOperation;
      const cachedFlags = await this.getCachedFeatureFlags();
      const current = () => !this.disposed && generation === this.generation && operation === this.refreshOperation;
      if (!current()) return this.retiredResponse();
      this.features = cachedFlags;
      this.emitEffectiveFlagsChanged(cachedFlags, current);
      return {
        status: 'cached' as TogglyLoadStatus,
        flags: cachedFlags,
      };
    }

    // If no app key, use defaults
    if (!this.config.appKey) {
      this.features = this.config.featureDefaults ?? {};
      this.emitEffectiveFlagsChanged(this.features);
      return {
        status: 'defaults' as TogglyLoadStatus,
        flags: this.features,
      };
    }

    // Fetch from server
    return this.fetchFeatureFlags();
  }

  /**
   * Fetch feature flags from the Toggly API.
   */
  private async fetchFeatureFlags(): Promise<TogglyInitResponse> {
    // Prevent duplicate fetches
    if (this.featuresLoading) {
      await this.waitForFeaturesLoaded();
      return {
        status: 'fetched' as TogglyLoadStatus,
        flags: this.features ?? {},
      };
    }

    const generation = this.generation;
    const operation = ++this.refreshOperation;
    const current = () => !this.disposed && generation === this.generation && operation === this.refreshOperation;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    this.featuresLoading = true;

    try {
      const pin = this.pendingDefinitionsPin;
      this.pendingDefinitionsPin = null;
      const url = appendDefinitionsRevisionParam(this.buildApiUrl(), pin);
      const revision = pin ? null : this.getDefinitionsRevision();
      const headers = buildDefinitionFetchHeaders(
        revision ? { 'If-None-Match': revision } : {},
      );

      const controller = new AbortController();
      this.activeRequest = controller;
      timeoutId = this.requestTimer = setTimeout(
        () => controller.abort(),
        this.config.requestTimeout
      );

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!current()) return this.retiredResponse();

      const responseRevision = extractDefinitionsRevision(response);

      if (response.status === 304) {
        if (!revision) throw new Error('Unexpected 304 without a matching verified body');
        // Not modified, use cached
        this.lastChecked = new Date();
        const cachedFlags = await this.getCachedFeatureFlags();
        if (!current()) return this.retiredResponse();
        // A conditional hit can refresh the validator for this cached context.
        if (revision) {
          await this.cacheDefinitionsRevision(responseRevision);
        }
        if (!current()) return this.retiredResponse();
        this.features = cachedFlags;
        this.emitEffectiveFlagsChanged(cachedFlags, current);
        return {
          status: 'cached' as TogglyLoadStatus,
          flags: cachedFlags,
        };
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const bodyText = await this.readResponseBody(response);
      if (!current()) return this.retiredResponse();
      let parsedDefs: unknown;

      if (this.config.verifySignatures) {
        const { envelope, defsRaw } = parseSignedEnvelope(bodyText);
        await this.verifySignedDefinitions(
          defsRaw,
          envelope.signature,
          envelope.timestamp,
          envelope.kid,
          controller.signal,
          current
        );
        parsedDefs = parseDefinitionsFromRaw(defsRaw);
      } else {
        const data = JSON.parse(bodyText) as {
          defs?: unknown;
          data?: unknown;
        };
        parsedDefs = data?.defs ?? data?.data ?? data;
      }

      if (!current()) return this.retiredResponse();

      let flags: FeatureFlags;
      let variants: Record<string, EvaluatedVariantDef> | null = null;
      if (this.config.enableVariants) {
        variants = asVariantDefsRecord<EvaluatedVariantDef>(parsedDefs);
        flags = variantDefsToFlags(variants);
      } else {
        flags = parsedDefs as FeatureFlags;
      }

      // Track changes
      const previousFlags = this.features;
      this.features = flags;
      this.variants = variants;

      // Cache the flags
      await this.cacheFeatureFlags(flags, variants);
      if (!current()) return this.retiredResponse();
      if (responseRevision) await this.cacheDefinitionsRevision(responseRevision);
      else {
        this.cachedDefinitionsRevision = null;
        const key = await this.buildFeatureFlagsCacheKey();
        if (!current()) return this.retiredResponse();
        await this.removePairedRevision(key);
      }
      if (!current()) return this.retiredResponse();

      this.lastChecked = new Date();
      this.lastSynced = new Date();
      this.lastError = null;

      // Transport admission finishes before callback-capable hooks, allowing a newer refresh.
      clearTimeout(timeoutId);
      this.requestTimer = undefined;
      this.activeRequest = undefined;
      this.featuresLoading = false;
      // Execute afterRefresh hooks
      await this.hookExecutor.executeAfterRefresh(toBooleanDefinitions(flags), current);
      if (!current()) return this.retiredResponse();

      // Emit refreshed event
      this.eventEmitter.emit('refreshed', flags, current);
      if (!current()) return this.retiredResponse();
      this.emitEffectiveFlagsChanged(flags, current);
      if (!current()) return this.retiredResponse();

      // Notify state change handlers
      if (previousFlags) {
        this.notifyFeatureChanges(previousFlags, flags, current);
      }

      return {
        status: 'fetched' as TogglyLoadStatus,
        flags,
      };
    } catch (error) {
      if (!current()) return this.retiredResponse();
      const hadLastKnownGood = this.features !== null;
      this.reportError('Error fetching feature flags', error, current);
      if (!current()) return this.retiredResponse();

      // Fall back to cache or defaults
      const cachedFlags = await this.getCachedFeatureFlags();
      if (!current()) return this.retiredResponse();
      this.features = cachedFlags;
      this.emitEffectiveFlagsChanged(cachedFlags, current);

      return {
        status: hadLastKnownGood
          ? ('cached' as TogglyLoadStatus)
          : ('error' as TogglyLoadStatus),
        flags: cachedFlags,
        error: this.lastError ?? undefined,
      };
    } finally {
      clearTimeout(timeoutId);
      if (operation === this.refreshOperation) {
        this.requestTimer = undefined;
        this.activeRequest = undefined;
        this.featuresLoading = false;
      }
    }
  }

  /**
   * Build the API URL for fetching feature flags.
   */
  private buildEndpointUrl(path: string): URL {
    const base = new URL(this.config.baseURI);
    // Hermes can ignore URL.pathname assignment. Construct the full URL so
    // both definitions and JWKS retain the configured base path and query.
    let credentials = '';
    if (base.username || base.password) {
      credentials = base.username;
      if (base.password) credentials += `:${base.password}`;
      credentials += '@';
    }
    // A pathname setter treats ? and # in app keys/environments as path data;
    // in a complete URL they would instead begin a query or fragment.
    const encodedPath = path.replace(/[?#]/g, character => character === '?' ? '%3F' : '%23');
    let basePath = base.pathname;
    while (basePath.endsWith('/')) basePath = basePath.slice(0, -1);
    const endpoint = [
      base.protocol,
      '//',
      credentials,
      base.host,
      basePath,
      '/',
      encodedPath,
      base.search,
      base.hash,
    ].join('');
    return new URL(endpoint);
  }

  private buildApiUrl(): string {
    const path = this.config.enableVariants ? 'evaluated-variants-signed' : 'evaluated-signed';
    const url = this.buildEndpointUrl(`${path}/${this.config.appKey}/${this.config.environment}`);
    url.searchParams.delete('i');
    if (this.instanceId) {
      for (const key of [...url.searchParams.keys()]) {
        if (key === 'u' || key === 'userId' || key === 'g' || key.startsWith('claim.')) url.searchParams.delete(key);
      }
      url.searchParams.set('i', this.instanceId);
    } else appendEvaluationContext(url, this.getEvaluationContext(), this.config.enableVariants ? 'variants' : 'evaluated');
    return url.toString();
  }

  private getEvaluationContext(): TogglyEvaluationContext {
    return {
      identity: this.identity ?? undefined,
      groups: this.groups.length ? [...this.groups] : undefined,
      claims: Object.keys(this.claims).length ? { ...this.claims } : undefined,
    };
  }

  private getContextCacheKey(): string {
    // JSON boundaries avoid collisions such as groups ["a,b"] and ["a", "b"].
    // Include the endpoint scope because storage can be shared by SDK instances.
    const url = new URL(this.buildApiUrl());
    const entries = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey !== rightKey) {
        return leftKey < rightKey ? -1 : 1;
      }
      if (leftValue === rightValue) {
        return 0;
      }
      return leftValue < rightValue ? -1 : 1;
    });
    return JSON.stringify([url.origin, url.pathname, entries]);
  }

  private async buildFeatureFlagsCacheKey(context = this.getContextCacheKey()): Promise<string> {
    const hashedContext = await sha256(context);
    return STORAGE_KEYS.FEATURE_FLAGS_CACHE + hashedContext;
  }

  private isTrackedCacheKey(key: string): boolean {
    return key.startsWith(STORAGE_KEYS.FEATURE_FLAGS_CACHE);
  }

  private async runSerializedLruMutation<T>(action: () => Promise<T>): Promise<T> {
    const run = this.lruMutationChain.then(action, action);
    this.lruMutationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async loadLruIndex(): Promise<CacheLruIndex> {
    try {
      return parseCacheLruIndex(await this.storage.get(STORAGE_KEYS.CACHE_LRU));
    } catch {
      return parseCacheLruIndex(null);
    }
  }

  private async saveLruIndex(index: CacheLruIndex): Promise<void> {
    if (this.disposed) return;
    try {
      await this.storage.set(STORAGE_KEYS.CACHE_LRU, serializeCacheLruIndex(index));
    } catch (error) {
      this.reportError('Error writing cache LRU index', error);
    }
  }

  private async touchCacheKey(key: string): Promise<void> {
    if (!isCacheLruEnabled(this.config.maxCacheKeys) || !this.isTrackedCacheKey(key)) {
      return;
    }
    await this.runSerializedLruMutation(async () => {
      try {
        const index = touchCacheLruKey(await this.loadLruIndex(), key);
        await this.saveLruIndex(index);
      } catch (error) {
        this.reportError('Error updating cache LRU index', error);
      }
    });
  }

  private async removePairedRevision(cacheKey: string): Promise<void> {
    const stored = await this.storage.get(STORAGE_KEYS.ETAG);
    if (this.disposed || !stored?.startsWith('{')) return;
    const record = JSON.parse(stored) as {context?: string};
    if (typeof record.context !== 'string') return;
    const revisionKey = await this.buildFeatureFlagsCacheKey(record.context);
    if (!this.disposed && revisionKey === cacheKey) await mutateCache(this.storage, STORAGE_KEYS.ETAG, null);
  }

  private async enforceMaxCacheKeys(protectKeys: string[]): Promise<void> {
    const maxKeys = this.config.maxCacheKeys;
    if (!isCacheLruEnabled(maxKeys)) {
      return;
    }
    await this.runSerializedLruMutation(async () => {
      try {
        let index = await this.loadLruIndex();
        if (this.disposed) return;
        const toEvict = selectCacheLruKeysToEvict(index, maxKeys as number, { protectKeys }).filter(
          (key) => this.isTrackedCacheKey(key),
        );
        if (toEvict.length === 0) {
          return;
        }
        for (const key of toEvict) {
          if (this.disposed) return;
          try {
            await this.removePairedRevision(key);
            if (this.disposed) return;
            await mutateCache(this.storage, key, null);
          } catch {
            /* ignore per-key removal failures */
          }
        }
        index = removeCacheLruKeys(index, toEvict);
        await this.saveLruIndex(index);
      } catch (error) {
        this.reportError('Error enforcing cache LRU limit', error);
      }
    });
  }

  private async removeCacheKeysFromLruIndex(keys: string[]): Promise<void> {
    if (!isCacheLruEnabled(this.config.maxCacheKeys)) {
      return;
    }
    await this.runSerializedLruMutation(async () => {
      try {
        const index = removeCacheLruKeys(await this.loadLruIndex(), keys);
        await this.saveLruIndex(index);
      } catch (error) {
        this.reportError('Error updating cache LRU index', error);
      }
    });
  }

  /**
   * Wait for features to finish loading.
   */
  private async waitForFeaturesLoaded(): Promise<void> {
    while (this.featuresLoading && !this.disposed) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Get cached feature flags.
   */
  private async getCachedFeatureFlags(): Promise<FeatureFlags> {
    if (this.features) return this.features;
    const context = this.getContextCacheKey();
    const generation = this.generation;
    const current = () => !this.disposed && generation === this.generation;
    try {
      const cacheKey = await this.buildFeatureFlagsCacheKey(context);
      if (!current()) return this.config.featureDefaults ?? {};
      const raw = await this.storage.get(cacheKey);
      const flags = this.decodeCachedFlags(raw, context);
      const storedRevision = await this.storage.get(STORAGE_KEYS.ETAG);
      const revision = storedRevision?.startsWith('{') ? JSON.parse(storedRevision) as CachedRevision : null;
      const body = raw ? JSON.parse(raw) as CachedBody : null;
      if (revision?.context === context && revision.writeId && revision.writeId !== body?.writeId) return this.config.featureDefaults ?? {};
      if (!current()) return this.config.featureDefaults ?? {};
      if (flags) {
        await this.touchCacheKey(cacheKey);
        if (!current()) return this.config.featureDefaults ?? {};
        if (this.config.enableVariants) this.variants = this.decodeCachedVariants(body, context);
        return current() ? flags : this.config.featureDefaults ?? {};
      }
    } catch (error) {
      if (current()) this.reportError('Error reading cached feature flags', error);
    }
    return this.config.featureDefaults ?? {};
  }

  /** Cache a body under the context captured before asynchronous storage. */
  private async cacheFeatureFlags(flags: FeatureFlags, variants?: Record<string, EvaluatedVariantDef> | null): Promise<void> {
    const context = this.getContextCacheKey();
    const generation = this.generation;
    const operation = this.refreshOperation;
    const current = () => !this.disposed && generation === this.generation && operation === this.refreshOperation;
    const encoded = JSON.stringify({
      identity: context,
      flags: JSON.stringify(flags),
      variants: variants ? JSON.stringify(variants) : undefined,
      writeId: generateUUID(),
    });
    try {
      const cacheKey = await this.buildFeatureFlagsCacheKey(context);
      if (!current()) return;
      await mutateCache(this.storage, cacheKey, encoded);
      if (!current()) return;
      await this.touchCacheKey(cacheKey);
      if (!current()) return;
      await this.enforceMaxCacheKeys([cacheKey]);
    } catch (error) {
      if (current()) this.reportError('Error writing feature flags cache', error);
    }
  }

  private async getJwks(signal: AbortSignal, isCurrent: () => boolean): Promise<JwkSet> {
    const cached = await this.storage.get(STORAGE_KEYS.JWKS);
    if (!isCurrent()) throw new Error('Toggly request is retired');
    if (cached) {
      return JSON.parse(cached) as JwkSet;
    }

    const url = this.buildEndpointUrl('.well-known/jwks');
    for (const key of [...url.searchParams.keys()]) {
      if (key === 'i' || key === 'u' || key === 'userId' || key === 'g' || key.startsWith('claim.')) url.searchParams.delete(key);
    }
    const response = await fetch(url.toString(), { signal });
    if (!isCurrent()) throw new Error('Toggly request is retired');
    if (!response.ok) {
      throw new Error(`Failed to fetch JWKs: ${response.status}`);
    }

    const jwks = (await response.json()) as JwkSet;
    if (!isCurrent()) throw new Error('Toggly request is retired');
    await this.storage.set(STORAGE_KEYS.JWKS, JSON.stringify(jwks));
    return jwks;
  }

  private async readResponseBody(response: Response): Promise<string> {
    if (typeof response.text === 'function') {
      return response.text();
    }
    // Some test doubles only implement json().
    return JSON.stringify(await response.json());
  }

  private async verifySignedDefinitions(
    defsRaw: string,
    signature: string | undefined,
    timestamp: number | undefined,
    keyId: string | undefined,
    signal: AbortSignal,
    isCurrent: () => boolean
  ): Promise<void> {
    if (!signature || timestamp === undefined || !keyId) {
      throw new Error('Signed definitions missing signature metadata');
    }
    if (this.config.trustedKeyIds?.length && !this.config.trustedKeyIds.includes(keyId)) {
      throw new Error('Signed definitions key is not trusted');
    }

    const jwks = await this.getJwks(signal, isCurrent);
    await verifySignedEnvelope(
      defsRaw,
      { signature, timestamp, kid: keyId },
      jwks,
      this.config.trustedKeyIds,
      { maxSignatureAgeSeconds: this.config.maxSignatureAgeSeconds }
    );
  }

  /**
   * Clear cached feature flags.
   */
  async clearCache(): Promise<void> {
    if (this.disposed) return;
    this.features = null;
    this.variants = null;
    this.cachedDefinitionsRevision = null;

    try {
      const cacheKey = await this.buildFeatureFlagsCacheKey();
      if (this.disposed) return;
      await mutateCache(this.storage, cacheKey, null);
      if (this.disposed) return;
      await mutateCache(this.storage, STORAGE_KEYS.ETAG, null);
      if (this.disposed) return;
      await this.storage.delete(STORAGE_KEYS.JWKS);
      await this.removeCacheKeysFromLruIndex([cacheKey]);
    } catch (error) {
      this.reportError('Error clearing feature flags cache', error);
    }
  }

  /**
   * Set user identity for targeting.
   * @param identity New identity string
   */
  async setIdentity(identity: string | null): Promise<TogglyInitResponse> {
    return this.setContext({ identity: identity ?? '' });
  }

  /** Replace supplied targeting fields; an identity-only change clears the token. */
  async setContext(context: TogglyEvaluationContext & { instanceId?: string }): Promise<TogglyInitResponse> {
    if (this.disposed) return this.retiredResponse();
    const intent = ++this.contextIntent;
    const currentIntent = () => !this.disposed && intent === this.contextIntent;
    const update = { ...context, groups: context.groups && [...context.groups], claims: context.claims && { ...context.claims } };
    const previousIdentity = this.identity;
    let nextIdentity = this.identity;
    const dataMap = update.identity !== undefined
      ? await this.hookExecutor.executeBeforeIdentify(update.identity ?? '', currentIntent)
      : undefined;
    if (!currentIntent()) return this.retiredResponse();
    if (update.identity !== undefined) {
      nextIdentity = update.identity || await this.storage.get(STORAGE_KEYS.DEVICE_ID);
      if (!currentIntent()) return this.retiredResponse();
      if (!nextIdentity) {
        nextIdentity = generateUUID();
        await this.storage.set(STORAGE_KEYS.DEVICE_ID, nextIdentity);
        if (!currentIntent()) return this.retiredResponse();
      }
    }
    this.generation++;
    this.refreshOperation++;
    const expected = this.generation;
    const current = () => currentIntent() && expected === this.generation;
    this.activeRequest?.abort();
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.activeRequest = undefined;
    this.requestTimer = undefined;
    this.featuresLoading = false;
    this.initialization = null;
    this.stopRefreshTimer();
    this.stopWebSocket();
    this.identity = nextIdentity;
    if (update.identity !== undefined && update.instanceId === undefined) this.instanceId = undefined;
    if (update.instanceId !== undefined) this.instanceId = update.instanceId.trim() || undefined;
    if (update.groups !== undefined) this.groups = update.groups;
    if (update.claims !== undefined) this.claims = update.claims;
    this.features = null;
    this.variants = null;
    this.cachedDefinitionsRevision = null;
    this.pendingDefinitionsPin = null;
    this.telemetry.setContext({ instanceId: this.instanceId, identity: this.identity ?? undefined });
    if (!current()) return this.retiredResponse();
    this.emitEffectiveFlagsChanged(this.config.featureDefaults ?? {}, current);
    if (!current()) return this.retiredResponse();
    // Preserve the existing context-transition retirement of cached signing keys.
    try { await this.storage.delete(STORAGE_KEYS.JWKS); }
    catch (error) { if (current()) this.reportError('Error clearing signing keys', error); }
    if (!current()) return this.retiredResponse();
    await this.loadCachedDefinitionsRevision();
    if (!current()) return this.retiredResponse();
    if (dataMap) {
      await this.hookExecutor.executeAfterIdentify(this.identity!, dataMap, current);
      if (!current()) return this.retiredResponse();
      this.eventEmitter.emit('identityChanged', { previousIdentity, newIdentity: this.identity }, current);
    }
    if (!current()) return this.retiredResponse();
    try { return await (this.isInitialized ? this.performRefresh() : this.init()); }
    finally { if (current() && this.isInitialized) { this.startRefreshTimer(); this.startWebSocket(); } }
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
    this.eventEmitter.emit('localGatesChanged');
    this.emitEffectiveFlagsChanged();
  }

  private captureEvaluation(featureKeys: string[]) {
    const record = this.telemetry.captureCheck();
    const source = this.features ?? this.config.featureDefaults ?? {};
    const flags: FeatureFlags = JSON.parse(JSON.stringify(Object.fromEntries(
      featureKeys.filter(key => Object.prototype.hasOwnProperty.call(source, key)).map(key => [key, source[key]])
    )));
    const variantSource = this.config.enableVariants ? this.variants ?? {} : {};
    const variants: Record<string, EvaluatedVariantDef> = JSON.parse(JSON.stringify(Object.fromEntries(
      featureKeys.filter(key => Object.prototype.hasOwnProperty.call(variantSource, key)).map(key => [key, variantSource[key]])
    )));
    const gates = this.localGates.map(gate => ({ ...gate, flagKeys: [...gate.flagKeys] }));
    const index = buildFlagGateIndex(gates);
    return (featureKey: string, entityContext?: TogglyEntityContext | null): boolean => {
      const remote = resolveEvaluatedDefinition(flags[featureKey], entityContext);
      const enabled = applyLocalGate(remote, featureKey, gates, index);
      const variantName = variants[featureKey]?.variant || 'enabled';
      record(featureKey, enabled ? variantName : 'disabled');
      return enabled;
    };
  }

  registerContext<T>(kind: string, mapper: (entity: T) => TogglyEntityContext): void {
    registerEntityContext(kind, mapper);
  }

  /**
   * Evaluate a feature gate with multiple feature keys.
   */
  async evaluateFeatureGate(
    featureKeys: string[],
    requirement: FeatureRequirement = 'all',
    negate = false,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean> {
    await this.ensureFeaturesLoaded();

    if (featureKeys.length === 0) {
      return true;
    }

    featureKeys = [...featureKeys];
    const captured = this.captureEvaluation(featureKeys);

    // Execute hooks for first feature key
    const dataMap = await this.hookExecutor.executeBeforeEvaluation(
      featureKeys[0]
    );

    const entityContext = normalizeEntityContext(entity, kind);
    const result = this.evaluateGateInternal(
      featureKeys,
      requirement,
      negate,
      entityContext,
      captured,
    );

    await this.hookExecutor.executeAfterEvaluation(
      featureKeys[0],
      dataMap,
      result
    );

    return result;
  }

  /**
   * Internal gate evaluation logic.
   */
  private evaluateGateInternal(
    featureKeys: string[],
    requirement: FeatureRequirement,
    negate: boolean,
    entityContext?: TogglyEntityContext | null,
    resolve = this.captureEvaluation(featureKeys),
  ): boolean {
    if (featureKeys.length === 1) {
      const isEnabled = resolve(featureKeys[0], entityContext);
      return negate ? !isEnabled : isEnabled;
    }

    let isEnabled: boolean;

    if (requirement === 'any') {
      isEnabled = featureKeys.some((key) => resolve(key, entityContext));
    } else {
      isEnabled = featureKeys.every((key) => resolve(key, entityContext));
    }

    return negate ? !isEnabled : isEnabled;
  }

  async isFeatureOn(
    featureKey: string,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean> {
    return this.evaluateFeatureGate([featureKey], 'all', false, entity, kind);
  }

  /**
   * Check if a feature is disabled.
   */
  async isFeatureOff(
    featureKey: string,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean> {
    return this.evaluateFeatureGate([featureKey], 'all', true, entity, kind);
  }

  /**
   * Current variant assignment for a feature (requires {@link TogglyConfig.enableVariants}
   * and loaded data). Records a telemetry check the same way `isFeatureOn` does.
   */
  getVariant(featureKey: string): VariantResult | null {
    if (!this.config.enableVariants || !this.variants) return null;
    const entry = this.variants[featureKey];
    const resolve = this.captureEvaluation([featureKey]);
    const enabled = resolve(featureKey);
    return enabled && entry?.variant ? { name: entry.variant, configurationValue: entry.configurationValue } : null;
  }

  /**
   * Configuration payload for the assigned variant, if any.
   * Optional `isT` type guard soft-fails to null on mismatch.
   */
  getVariantValue<T = unknown>(
    featureKey: string,
    isT?: (v: unknown) => v is T,
  ): T | null {
    return decodeVariantValue(this.getVariant(featureKey)?.configurationValue, isT);
  }

  /**
   * Ensure features are loaded before evaluation.
   */
  private async ensureFeaturesLoaded(): Promise<void> {
    if (this.disposed) return;
    if (this.features !== null) {
      return;
    }

    if (this.featuresLoading) {
      await this.waitForFeaturesLoaded();
      return;
    }

    // Load from cache or defaults
    const generation = this.generation;
    const flags = await this.getCachedFeatureFlags();
    if (!this.disposed && generation === this.generation) this.features = flags;
  }

  /**
   * Start a WebSocket connection for real-time flag updates.
   * Uses the global WebSocket provided by the React Native runtime.
   */
  private startWebSocket(): void {
    if (this.disposed || !this.config.appKey || !this.config.enableLiveUpdates) {
      return;
    }

    this.stopWebSocket();

    const url = buildWebSocketUrl(
      this.config.baseURI,
      this.config.appKey,
      this.getDefinitionsRevision(),
    );

    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        if (this.disposed || this._ws !== ws) return;
        this._wsConnected = true;
        this._wsReconnectAttempt = 0;
        this._lastFallbackRefresh = Date.now();
      };

      ws.onmessage = (event: MessageEvent) => {
        if (this.disposed || this._ws !== ws) return;
        const data = typeof event.data === 'string' ? event.data : '';

        if (data === 'update' || data === 'flags-updated') {
          this.scheduleDebouncedRefresh();
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
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (this.disposed || this._ws !== ws) return;
        this._wsConnected = false;
        this._ws = null;
        this.scheduleWsReconnect();
      };

      ws.onerror = (err: Event) => {
        if (this.disposed || this._ws !== ws) return;
        console.error('[Toggly] WebSocket error:', err);
      };

      this._ws = ws;
    } catch (error) {
      console.error('[Toggly] Failed to create WebSocket:', error);
      this.scheduleWsReconnect();
    }
  }

  /**
   * Schedule a WebSocket reconnection attempt after a delay.
   */
  private scheduleWsReconnect(): void {
    if (this.disposed) return;
    if (this._wsReconnectTimer) {
      clearTimeout(this._wsReconnectTimer);
    }
    const delay = getNextReconnectDelayMs(this._wsReconnectAttempt);
    this._wsReconnectAttempt += 1;
    this._wsReconnectTimer = setTimeout(() => {
      this._wsReconnectTimer = null;
      if (this.config.enableLiveUpdates && this.appState === 'active') {
        this.startWebSocket();
      }
    }, delay);
  }

  /**
   * Stop the WebSocket connection and cancel any pending reconnect.
   */
  private stopWebSocket(): void {
    if (this._wsReconnectTimer) {
      clearTimeout(this._wsReconnectTimer);
      this._wsReconnectTimer = null;
    }
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
      this._refreshDebounceTimer = null;
    }
    if (this._ws) {
      this._ws.onopen = null;
      this._ws.onmessage = null;
      this._ws.onclose = null;
      this._ws.onerror = null;
      this._ws.close();
      this._ws = null;
    }
    this._wsConnected = false;
  }

  /**
   * Start the automatic refresh timer.
   */
  private startRefreshTimer(): void {
    this.stopRefreshTimer();
    if (this.disposed) return;

    if (this.config.appKey && this.config.refreshInterval > 0) {
      this.refreshTimer = setInterval(() => {
        if (this.appState !== 'active') {
          return;
        }

        // When WebSocket is connected, only poll as a fallback safety net
        if (this._wsConnected) {
          const elapsed = Date.now() - this._lastFallbackRefresh;
          if (elapsed < FALLBACK_REFRESH_INTERVAL) {
            return;
          }
          this._lastFallbackRefresh = Date.now();
        }

        this.refresh();
      }, this.config.refreshInterval);
    }
  }

  /**
   * Stop the automatic refresh timer.
   */
  private stopRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Add a hook dynamically.
   */
  addHook(hook: Hook): void {
    this.hookExecutor.addHook(hook);
  }

  /**
   * Remove a hook by name.
   */
  removeHook(name: string): boolean {
    return this.hookExecutor.removeHook(name);
  }

  /**
   * Subscribe to Toggly events.
   */
  on(eventType: TogglyEventType, listener: TogglyEventListener): () => void {
    return this.eventEmitter.on(eventType, listener);
  }

  /**
   * Subscribe to all Toggly events.
   */
  onAll(listener: TogglyEventListener): () => void {
    return this.eventEmitter.onAll(listener);
  }

  /**
   * Add a feature state change handler.
   */
  addStateChangeHandler(handler: FeatureStateChangeHandler): () => void {
    this.stateChangeHandlers.add(handler);
    return () => {
      this.stateChangeHandlers.delete(handler);
    };
  }

  /**
   * Notify handlers about feature changes.
   */
  private notifyFeatureChanges(
    previousFlags: FeatureFlags,
    newFlags: FeatureFlags,
    isCurrent: () => boolean = () => true
  ): void {
    const allKeys = new Set([
      ...Object.keys(previousFlags),
      ...Object.keys(newFlags),
    ]);

    for (const key of allKeys) {
      if (!isCurrent()) return;
      const previousValue = resolveEvaluatedDefinition(previousFlags[key]);
      const newValue = resolveEvaluatedDefinition(newFlags[key]);

      if (previousValue !== newValue) {
        this.eventEmitter.emit('featureChanged', {
          featureKey: key,
          previousValue,
          newValue,
        }, isCurrent);

        this.stateChangeHandlers.forEach((handler) => {
          if (!isCurrent()) return;
          try {
            handler(key, previousValue, newValue);
          } catch (error) {
            console.error('[Toggly] Error in state change handler:', error);
          }
        });
      }
    }
  }

  /**
   * Get debug information.
   */
  getDebugInfo(): TogglyDebugInfo {
    return {
      identity: this.identity,
      appKey: this.config.appKey ?? null,
      environment: this.config.environment,
      useSignedDefinitions: this.config.useSignedDefinitions,
      isAppInForeground: this.appState === 'active',
      refreshInterval: this.config.refreshInterval,
      syncServiceRunning: this.refreshTimer !== null,
      wsConnected: this._wsConnected,
      lastChecked: this.lastChecked,
      lastSynced: this.lastSynced,
      eTag: this.cachedDefinitionsRevision,
      lastError: this.lastError,
      networkState: this.networkState,
      appState: this.appState,
    };
  }

  /** Record an explicit feature usage; this does not evaluate the feature. */
  recordUsage(featureKey: string, variant = 'enabled'): void { this.telemetry.recordUsage(featureKey, variant); }
  recordView(featureKey: string, variant = 'enabled'): void { this.telemetry.recordView(featureKey, variant); }
  incrementCounter(metricKey: string, value = 1): void { this.telemetry.incrementCounter(metricKey, value); }
  setGauge(metricKey: string, value: number): void { this.telemetry.setGauge(metricKey, value); }
  flushTelemetry(): Promise<void> { return this.telemetry.flush(); }

  private retiredResponse(): TogglyInitResponse {
    return { status: 'cached' as TogglyLoadStatus, flags: this.config.featureDefaults };
  }

  /** Retire the owner synchronously and attempt one bounded final telemetry envelope. */
  dispose(options?: { flush?: boolean }): void {
    if (this.disposed) {
      if (options?.flush === false) this.telemetry.dispose(options);
      return;
    }
    this.disposed = true;
    this.generation++;
    this.refreshOperation++;
    this.contextIntent++;
    this.telemetry.dispose(options);
    this.activeRequest?.abort();
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.stopWebSocket();
    this.stopRefreshTimer();
    this.networkUnsubscribe?.();
    this.appStateUnsubscribe?.();
    this.eventEmitter.removeAllListeners();
    this.stateChangeHandlers.clear();
    this.hookExecutor.clearHooks();
    this.features = null;
    this.variants = null;
    this.isInitialized = false;
  }
}
