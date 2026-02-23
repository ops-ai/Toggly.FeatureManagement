import type { Hook } from '@ops-ai/toggly-hooks-types';
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

/**
 * Storage keys used by Toggly
 */
const STORAGE_KEYS = {
  DEVICE_ID: '@toggly:deviceId',
  FEATURE_FLAGS_CACHE: '@toggly:featureFlagsCache:',
  ETAG: '@toggly:etag',
  JWKS: '@toggly:jwks',
} as const;

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
    >
  > &
    TogglyConfig;

  private storage: TogglyStorage;
  private hookExecutor: HookExecutor;
  private eventEmitter: EventEmitter;

  private features: FeatureFlags | null = null;
  private featuresLoading = false;
  private identity: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastChecked: Date | null = null;
  private lastSynced: Date | null = null;
  private lastError: string | null = null;
  private eTag: string | null = null;
  private isInitialized = false;
  private networkState: NetworkState | null = null;
  private appState: AppStateType = 'active';
  private stateChangeHandlers: Set<FeatureStateChangeHandler> = new Set();
  private networkUnsubscribe: (() => void) | null = null;
  private appStateUnsubscribe: (() => void) | null = null;

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

  constructor(config: TogglyConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = config.storage ?? new MemoryStorage();
    this.hookExecutor = new HookExecutor();
    this.eventEmitter = new EventEmitter();

    // Register initial hooks
    if (config.hooks) {
      config.hooks.forEach((hook) => this.hookExecutor.addHook(hook));
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

    // Start refresh timer
    this.startRefreshTimer();

    // Perform initial refresh
    const response = await this.refresh();

    this.isInitialized = true;
    this.eventEmitter.emit('initialized', response);

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
      const headers: Record<string, string> = {};

      if (this.config.useSignedDefinitions && this.eTag) {
        headers['If-None-Match'] = this.eTag;
      }

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

      if (response.status === 304) {
        // Not modified, use cached
        this.lastChecked = new Date();
        const cachedFlags = await this.getCachedFeatureFlags();
        this.features = cachedFlags;
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

      // Track changes
      const previousFlags = this.features;
      this.features = flags;

      // Cache the flags
      await this.cacheFeatureFlags(flags);

      // Store ETag
      const newEtag = response.headers.get('etag');
      if (newEtag) {
        this.eTag = newEtag;
        await this.storage.set(STORAGE_KEYS.ETAG, newEtag);
      }

      this.lastChecked = new Date();
      this.lastSynced = new Date();
      this.lastError = null;

      // Execute afterRefresh hooks
      await this.hookExecutor.executeAfterRefresh(flags);

      // Emit refreshed event
      this.eventEmitter.emit('refreshed', flags);

      // Notify state change handlers
      if (previousFlags) {
        this.notifyFeatureChanges(previousFlags, flags);
      }

      return {
        status: 'fetched' as TogglyLoadStatus,
        flags,
      };
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : 'Unknown error';
      this.eventEmitter.emit('error', { error: this.lastError });

      // Fall back to cache or defaults
      const cachedFlags = await this.getCachedFeatureFlags();
      this.features = cachedFlags;

      return {
        status: 'defaults' as TogglyLoadStatus,
        flags: cachedFlags,
        error: this.lastError,
      };
    } finally {
      this.featuresLoading = false;
    }
  }

  /**
   * Build the API URL for fetching feature flags.
   */
  private buildApiUrl(): string {
    let url = `${this.config.baseURI}/evaluated-signed/${this.config.appKey}/${this.config.environment}`;

    if (this.identity) {
      url += `?u=${encodeURIComponent(this.identity)}`;
    }

    return url;
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
      const hashedIdentity = await sha256(this.identity ?? '');
      const cacheKey = STORAGE_KEYS.FEATURE_FLAGS_CACHE + hashedIdentity;
      const cached = await this.storage.get(cacheKey);

      if (cached) {
        const cacheData: TogglyFeatureFlagsCache = JSON.parse(cached);
        if (cacheData.identity === this.identity) {
          return JSON.parse(cacheData.flags);
        }
      }
    } catch {
      // Cache read failed, use defaults
    }

    return this.config.featureDefaults ?? {};
  }

  /**
   * Cache feature flags to storage.
   */
  private async cacheFeatureFlags(flags: FeatureFlags): Promise<void> {
    try {
      const hashedIdentity = await sha256(this.identity ?? '');
      const cacheKey = STORAGE_KEYS.FEATURE_FLAGS_CACHE + hashedIdentity;
      const cacheData: TogglyFeatureFlagsCache = {
        identity: this.identity ?? '',
        flags: JSON.stringify(flags),
      };
      await this.storage.set(cacheKey, JSON.stringify(cacheData));
    } catch {
      // Cache write failed, continue without caching
    }
  }

  /**
   * Clear cached feature flags.
   */
  async clearCache(): Promise<void> {
    this.features = null;
    this.eTag = null;

    try {
      const hashedIdentity = await sha256(this.identity ?? '');
      const cacheKey = STORAGE_KEYS.FEATURE_FLAGS_CACHE + hashedIdentity;
      await this.storage.delete(cacheKey);
      await this.storage.delete(STORAGE_KEYS.ETAG);
    } catch {
      // Cache clear failed, continue
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

    // Fast path for single feature
    if (featureKeys.length === 1) {
      const isEnabled = flags[featureKeys[0]] === true;
      return negate ? !isEnabled : isEnabled;
    }

    let isEnabled: boolean;

    if (requirement === 'any') {
      isEnabled = featureKeys.some((key) => flags[key] === true);
    } else {
      isEnabled = featureKeys.every((key) => flags[key] === true);
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
   * Start the automatic refresh timer.
   */
  private startRefreshTimer(): void {
    this.stopRefreshTimer();

    if (this.config.appKey && this.config.refreshInterval > 0) {
      this.refreshTimer = setInterval(() => {
        if (this.appState === 'active') {
          this.refresh();
        }
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
      lastChecked: this.lastChecked,
      lastSynced: this.lastSynced,
      eTag: this.eTag,
      lastError: this.lastError,
      networkState: this.networkState,
      appState: this.appState,
    };
  }

  /**
   * Dispose the service and clean up resources.
   */
  dispose(): void {
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
