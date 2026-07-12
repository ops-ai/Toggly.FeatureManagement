import type { CacheLruIndex, Hook, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import {
  appendEvaluationContext,
  evaluationContextCacheKey,
  isCacheLruEnabled,
  parseCacheLruIndex,
  removeCacheLruKeys,
  selectCacheLruKeysToEvict,
  serializeCacheLruIndex,
  touchCacheLruKey,
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
} from '../models';
import { HookExecutor } from './HookExecutor';
import { EventEmitter } from './EventEmitter';
import { MemoryStorage } from './MemoryStorage';
import {
  buildWebSocketUrl,
  extractDefinitionsRevision,
  getNextReconnectDelayMs,
  REFRESH_DEBOUNCE_MS,
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  shouldFetchOnSync,
  type WsSyncMessage,
} from '../ws-sync';
import { buildDefinitionFetchHeaders } from '../sdk-identity';

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

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  const maybeBuffer = (globalThis as unknown as {
    Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } };
  }).Buffer;
  const binary = typeof atob === 'function'
    ? atob(padded)
    : maybeBuffer?.from(padded, 'base64').toString('binary') ?? '';
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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
  private featuresLoading = false;
  /** Serializes LRU index read-modify-write to avoid lost updates. */
  private lruMutationChain: Promise<void> = Promise.resolve();
  private identity: string | null = null;
  private groups: string[] = [];
  private claims: Record<string, string> = {};
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastChecked: Date | null = null;
  private lastSynced: Date | null = null;
  private lastError: string | null = null;
  private cachedDefinitionsRevision: string | null = null;
  private isInitialized = false;
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

  private reportError(message: string, error?: unknown): void {
    this.lastError = error instanceof Error ? error.message : message;
    this.config.onError?.(
      error instanceof Error ? error : new Error(message)
    );
    this.eventEmitter.emit('error', { error: this.lastError });
  }

  private emitEffectiveFlagsChanged(flags: FeatureFlags = this.features ?? {}): void {
    this.eventEmitter.emit('effectiveFlagsChanged', flags);
  }

  private getDefinitionsRevision(): string | null {
    if (this.cachedDefinitionsRevision) {
      return this.cachedDefinitionsRevision;
    }
    return null;
  }

  private async loadCachedDefinitionsRevision(): Promise<void> {
    if (this.cachedDefinitionsRevision) {
      return;
    }
    try {
      const stored = await this.storage.get(STORAGE_KEYS.ETAG);
      if (stored) {
        this.cachedDefinitionsRevision = stored;
      }
    } catch (error) {
      this.reportError('Error reading definitions revision cache', error);
    }
  }

  private async cacheDefinitionsRevision(revision: string | null | undefined): Promise<void> {
    if (!revision) {
      return;
    }
    const normalized = revision.replace(/^"+|"+$/g, '');
    this.cachedDefinitionsRevision = normalized;
    try {
      await this.storage.set(STORAGE_KEYS.ETAG, normalized);
    } catch (error) {
      this.reportError('Error writing definitions revision cache', error);
    }
  }

  private scheduleDebouncedRefresh(forceRevisionReset = false): void {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
    }
    this._refreshDebounceTimer = setTimeout(() => {
      this._refreshDebounceTimer = null;
      if (forceRevisionReset) {
        this.cachedDefinitionsRevision = null;
        void this.storage.delete(STORAGE_KEYS.ETAG);
      }
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private handleWsSyncMessage(message: WsSyncMessage): void {
    const previousRevision = this.getDefinitionsRevision();
    if (shouldFetchOnSync(message, previousRevision)) {
      this.scheduleDebouncedRefresh();
    }
    if (message.etag) {
      void this.cacheDefinitionsRevision(message.etag);
    }
  }

  private handleWsUpdateMessage(message: WsSyncMessage): void {
    if (shouldFetchOnSigningKeyUpdated(message)) {
      this.scheduleDebouncedRefresh(true);
      return;
    }
    const previousRevision = this.getDefinitionsRevision();
    if (shouldFetchOnFlagsUpdated(message, previousRevision)) {
      this.scheduleDebouncedRefresh();
    }
    if (message.etag) {
      void this.cacheDefinitionsRevision(message.etag);
    }
  }

  constructor(config: TogglyConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
        const wasOffline = this.networkState?.isConnected === false;
        this.networkState = state;
        this.eventEmitter.emit('networkChanged', state);

        // Refresh when coming back online
        if (wasOffline && state.isConnected) {
          this.refresh();
        }
      });

      // Get initial network state
      config.networkInfo.getState().then((state) => {
        this.networkState = state;
      });
    }

    // Setup app state listener
    if (config.appState) {
      this.appState = config.appState.getCurrentState();
      this.appStateUnsubscribe = config.appState.subscribe((state) => {
        const wasBackground = this.appState === 'background';
        this.appState = state;
        this.eventEmitter.emit('appStateChanged', state);

        // Refresh when coming to foreground
        if (wasBackground && state === 'active') {
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
    // Handle identity
    if (this.config.identity) {
      this.identity = this.config.identity;
    } else {
      // Try to get stored device ID
      let storedId = await this.storage.get(STORAGE_KEYS.DEVICE_ID);
      if (!storedId) {
        storedId = generateUUID();
        await this.storage.set(STORAGE_KEYS.DEVICE_ID, storedId);
      }
      this.identity = storedId;
    }

    this.groups = this.config.groups ? [...this.config.groups] : [];
    this.claims = this.config.claims ? { ...this.config.claims } : {};

    // Start refresh timer
    this.startRefreshTimer();

    // Load cached definitions revision for conditional HTTP requests
    await this.loadCachedDefinitionsRevision();

    // Perform initial refresh
    const response = await this.refresh();

    this.isInitialized = true;
    this.eventEmitter.emit('initialized', response);

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
    // Skip refresh if app is not in foreground
    if (this.appState !== 'active') {
      return {
        status: 'cached' as TogglyLoadStatus,
        flags: this.features ?? this.config.featureDefaults,
      };
    }

    // Skip refresh if offline
    if (this.networkState?.isConnected === false) {
      const cachedFlags = await this.getCachedFeatureFlags();
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

    this.featuresLoading = true;

    try {
      const url = this.buildApiUrl();
      const revision = this.getDefinitionsRevision();
      const headers = buildDefinitionFetchHeaders(
        revision ? { 'If-None-Match': revision } : {},
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.requestTimeout
      );

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseRevision = extractDefinitionsRevision(response);
      if (responseRevision) {
        await this.cacheDefinitionsRevision(responseRevision);
      }

      if (response.status === 304) {
        // Not modified, use cached
        this.lastChecked = new Date();
        const cachedFlags = await this.getCachedFeatureFlags();
        this.features = cachedFlags;
        this.emitEffectiveFlagsChanged(cachedFlags);
        return {
          status: 'cached' as TogglyLoadStatus,
          flags: cachedFlags,
        };
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      let flags: FeatureFlags;

      flags = (data?.defs ?? data?.data ?? data) as FeatureFlags;

      if (this.config.useSignedDefinitions && this.config.verifySignatures) {
        await this.verifySignedDefinitions(
          flags,
          data?.signature,
          data?.timestamp,
          data?.kid ?? data?.keyId
        );
      }

      // Track changes
      const previousFlags = this.features;
      this.features = flags;

      // Cache the flags
      await this.cacheFeatureFlags(flags);

      this.lastChecked = new Date();
      this.lastSynced = new Date();
      this.lastError = null;

      // Execute afterRefresh hooks
      await this.hookExecutor.executeAfterRefresh(flags);

      // Emit refreshed event
      this.eventEmitter.emit('refreshed', flags);
      this.emitEffectiveFlagsChanged(flags);

      // Notify state change handlers
      if (previousFlags) {
        this.notifyFeatureChanges(previousFlags, flags);
      }

      return {
        status: 'fetched' as TogglyLoadStatus,
        flags,
      };
    } catch (error) {
      const hadLastKnownGood = this.features !== null;
      this.reportError('Error fetching feature flags', error);

      // Fall back to cache or defaults
      const cachedFlags = await this.getCachedFeatureFlags();
      this.features = cachedFlags;
      this.emitEffectiveFlagsChanged(cachedFlags);

      return {
        status: hadLastKnownGood
          ? ('cached' as TogglyLoadStatus)
          : ('error' as TogglyLoadStatus),
        flags: cachedFlags,
        error: this.lastError ?? undefined,
      };
    } finally {
      this.featuresLoading = false;
    }
  }

  /**
   * Build the API URL for fetching feature flags.
   */
  private buildApiUrl(): string {
    const url = new URL(
      `${this.config.baseURI}/evaluated-signed/${this.config.appKey}/${this.config.environment}`,
    );
    appendEvaluationContext(url, this.getEvaluationContext(), 'evaluated');
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
    return evaluationContextCacheKey(this.getEvaluationContext());
  }

  private async buildFeatureFlagsCacheKey(): Promise<string> {
    const hashedContext = await sha256(this.getContextCacheKey());
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

  private async enforceMaxCacheKeys(protectKeys: string[]): Promise<void> {
    const maxKeys = this.config.maxCacheKeys;
    if (!isCacheLruEnabled(maxKeys)) {
      return;
    }
    await this.runSerializedLruMutation(async () => {
      try {
        let index = await this.loadLruIndex();
        const toEvict = selectCacheLruKeysToEvict(index, maxKeys as number, { protectKeys }).filter(
          (key) => this.isTrackedCacheKey(key),
        );
        if (toEvict.length === 0) {
          return;
        }
        for (const key of toEvict) {
          try {
            await this.storage.delete(key);
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
    while (this.featuresLoading) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Get cached feature flags.
   */
  private async getCachedFeatureFlags(): Promise<FeatureFlags> {
    if (this.features) {
      return this.features;
    }

    try {
      const cacheKey = await this.buildFeatureFlagsCacheKey();
      const cached = await this.storage.get(cacheKey);

      if (cached) {
        const cacheData: TogglyFeatureFlagsCache = JSON.parse(cached);
        if (cacheData.identity === this.getContextCacheKey()) {
          await this.touchCacheKey(cacheKey);
          return JSON.parse(cacheData.flags);
        }
      }
    } catch (error) {
      this.reportError('Error reading cached feature flags', error);
    }

    return this.config.featureDefaults ?? {};
  }

  /**
   * Cache feature flags to storage.
   */
  private async cacheFeatureFlags(flags: FeatureFlags): Promise<void> {
    try {
      const cacheKey = await this.buildFeatureFlagsCacheKey();
      const cacheData: TogglyFeatureFlagsCache = {
        identity: this.getContextCacheKey(),
        flags: JSON.stringify(flags),
      };
      await this.storage.set(cacheKey, JSON.stringify(cacheData));
      await this.touchCacheKey(cacheKey);
      await this.enforceMaxCacheKeys([cacheKey]);
    } catch (error) {
      this.reportError('Error writing feature flags cache', error);
    }
  }

  private async getJwks(): Promise<{ keys?: Array<Record<string, string>> }> {
    const cached = await this.storage.get(STORAGE_KEYS.JWKS);
    if (cached) {
      return JSON.parse(cached);
    }

    const response = await fetch(`${this.config.baseURI}/.well-known/jwks`);
    if (!response.ok) {
      throw new Error(`Failed to fetch JWKs: ${response.status}`);
    }

    const jwks = await response.json();
    await this.storage.set(STORAGE_KEYS.JWKS, JSON.stringify(jwks));
    return jwks;
  }

  private async verifySignedDefinitions(
    flags: FeatureFlags,
    signature: string | undefined,
    timestamp: number | undefined,
    keyId: string | undefined
  ): Promise<void> {
    if (!signature || timestamp === undefined || !keyId) {
      throw new Error('Signed definitions missing signature metadata');
    }
    if (this.config.trustedKeyIds?.length && !this.config.trustedKeyIds.includes(keyId)) {
      throw new Error('Signed definitions key is not trusted');
    }
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('WebCrypto is required to verify signed definitions');
    }

    const jwks = await this.getJwks();
    const jwk = jwks.keys?.find((key) => key.kid === keyId);
    if (!jwk) {
      throw new Error(`No JWK found for key ${keyId}`);
    }

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      { ...jwk, kty: jwk.kty ?? 'EC', crv: jwk.crv ?? 'P-256', ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const payload = new TextEncoder().encode(`${JSON.stringify(flags)}|${timestamp}`);
    const isValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      base64UrlToBytes(signature) as Uint8Array<ArrayBuffer>,
      payload
    );
    if (!isValid) {
      throw new Error('Invalid signed definitions signature');
    }
  }

  /**
   * Clear cached feature flags.
   */
  async clearCache(): Promise<void> {
    this.features = null;
    this.cachedDefinitionsRevision = null;

    try {
      const cacheKey = await this.buildFeatureFlagsCacheKey();
      await this.storage.delete(cacheKey);
      await this.storage.delete(STORAGE_KEYS.ETAG);
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
    const previousIdentity = this.identity;

    // Execute beforeIdentify hooks
    const dataMap = await this.hookExecutor.executeBeforeIdentify(
      identity ?? ''
    );

    if (identity) {
      this.identity = identity;
    } else {
      // Fall back to device ID
      let deviceId = await this.storage.get(STORAGE_KEYS.DEVICE_ID);
      if (!deviceId) {
        deviceId = generateUUID();
        await this.storage.set(STORAGE_KEYS.DEVICE_ID, deviceId);
      }
      this.identity = deviceId;
    }

    // Clear cache if identity changed
    if (previousIdentity !== this.identity) {
      await this.clearCache();
    }

    // Execute afterIdentify hooks
    await this.hookExecutor.executeAfterIdentify(this.identity, dataMap);

    // Emit event
    this.eventEmitter.emit('identityChanged', {
      previousIdentity,
      newIdentity: this.identity,
    });

    return this.refresh();
  }

  /**
   * Set evaluation context (identity, groups, claims) and refresh flags.
   */
  async setContext(context: TogglyEvaluationContext): Promise<TogglyInitResponse> {
    if (context.identity !== undefined) {
      const identityResponse = await this.setIdentity(context.identity ?? null);
      if (context.groups === undefined && context.claims === undefined) {
        return identityResponse;
      }
    }
    if (context.groups !== undefined) {
      this.groups = [...context.groups];
    }
    if (context.claims !== undefined) {
      this.claims = { ...context.claims };
    }
    await this.clearCache();
    return this.refresh();
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

  private getEffectiveFlag(featureKey: string, remote: boolean): boolean {
    return applyLocalGate(remote, featureKey, this.localGates, this.localGateIndex);
  }

  /**
   * Evaluate a feature gate with multiple feature keys.
   */
  async evaluateFeatureGate(
    featureKeys: string[],
    requirement: FeatureRequirement = 'all',
    negate = false
  ): Promise<boolean> {
    await this.ensureFeaturesLoaded();

    if (featureKeys.length === 0) {
      return true;
    }

    // Execute hooks for first feature key
    const dataMap = await this.hookExecutor.executeBeforeEvaluation(
      featureKeys[0]
    );

    const result = this.evaluateGateInternal(featureKeys, requirement, negate);

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
    negate: boolean
  ): boolean {
    const flags = this.features ?? this.config.featureDefaults ?? {};

    if (featureKeys.length > 0 && Object.keys(flags).length === 0) {
      return negate;
    }

    // Fast path for single feature
    if (featureKeys.length === 1) {
      const remote = flags[featureKeys[0]] === true;
      const isEnabled = this.getEffectiveFlag(featureKeys[0], remote);
      return negate ? !isEnabled : isEnabled;
    }

    let isEnabled: boolean;

    if (requirement === 'any') {
      isEnabled = featureKeys.some((key) =>
        this.getEffectiveFlag(key, flags[key] === true)
      );
    } else {
      isEnabled = featureKeys.every((key) =>
        this.getEffectiveFlag(key, flags[key] === true)
      );
    }

    return negate ? !isEnabled : isEnabled;
  }

  /**
   * Check if a feature is enabled.
   */
  async isFeatureOn(featureKey: string): Promise<boolean> {
    return this.evaluateFeatureGate([featureKey], 'all', false);
  }

  /**
   * Check if a feature is disabled.
   */
  async isFeatureOff(featureKey: string): Promise<boolean> {
    return this.evaluateFeatureGate([featureKey], 'all', true);
  }

  /**
   * Ensure features are loaded before evaluation.
   */
  private async ensureFeaturesLoaded(): Promise<void> {
    if (this.features !== null) {
      return;
    }

    if (this.featuresLoading) {
      await this.waitForFeaturesLoaded();
      return;
    }

    // Load from cache or defaults
    this.features = await this.getCachedFeatureFlags();
  }

  /**
   * Start a WebSocket connection for real-time flag updates.
   * Uses the global WebSocket provided by the React Native runtime.
   */
  private startWebSocket(): void {
    if (!this.config.appKey || !this.config.enableLiveUpdates) {
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
        this._wsConnected = true;
        this._wsReconnectAttempt = 0;
        this._lastFallbackRefresh = Date.now();
      };

      ws.onmessage = (event: MessageEvent) => {
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
        this._wsConnected = false;
        this._ws = null;
        this.scheduleWsReconnect();
      };

      ws.onerror = (err: Event) => {
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
    newFlags: FeatureFlags
  ): void {
    const allKeys = new Set([
      ...Object.keys(previousFlags),
      ...Object.keys(newFlags),
    ]);

    for (const key of allKeys) {
      const previousValue = previousFlags[key];
      const newValue = newFlags[key];

      if (previousValue !== newValue) {
        this.eventEmitter.emit('featureChanged', {
          featureKey: key,
          previousValue,
          newValue,
        });

        this.stateChangeHandlers.forEach((handler) => {
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

  /**
   * Dispose the service and clean up resources.
   */
  dispose(): void {
    this.stopWebSocket();
    this.stopRefreshTimer();
    this.networkUnsubscribe?.();
    this.appStateUnsubscribe?.();
    this.eventEmitter.removeAllListeners();
    this.stateChangeHandlers.clear();
    this.hookExecutor.clearHooks();
    this.features = null;
    this.isInitialized = false;
  }
}
