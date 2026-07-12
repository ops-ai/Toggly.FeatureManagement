import { v4 as uuidv4 } from 'uuid';
import { FeatureRequirement, StorageKeys, TogglyConfig, VariantResult, EvaluatedVariantDef } from './models';
import { HookExecutor } from './hooks';
import type { Hook, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import {
  appendEvaluationContext,
  evaluationContextCacheKey,
  isCacheLruEnabled,
  parseCacheLruIndex,
  removeCacheLruKeys,
  selectCacheLruKeysToEvict,
  serializeCacheLruIndex,
  touchCacheLruKey,
  type CacheLruIndex,
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
  shouldFetchOnFlagsUpdated,
  shouldFetchOnSigningKeyUpdated,
  shouldFetchOnSync,
  type WsSyncMessage,
} from './ws-sync';
import { buildDefinitionFetchHeaders } from './sdk-identity';

const canUseStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export class Toggly {
  private static _config: TogglyConfig;
  private static _refreshInterval: number | undefined;
  private static _hookExecutor = new HookExecutor();
  private static _localGates: LocalGate[] = [];
  private static _localGateIndex: FlagGateIndex = new Map();
  private static _localGatesChangedListeners = new Set<() => void>();
  private static _inMemoryFlags: { [key: string]: boolean } | null = null;
  private static _hasLoadedFlags = false;
  private static _lastError: string | undefined;

  static _ws: WebSocket | null = null;
  static _wsConnected: boolean = false;
  static _wsReconnectTimer: any = null;
  static _wsReconnectAttempt: number = 0;
  static _refreshDebounceTimer: any = null;
  static _cachedDefinitionsRevision: string | null = null;
  static _lastFallbackRefresh: number = 0;
  static _fallbackRefreshInterval: number = 20 * 60 * 1000;

  private static get _revisionCacheKey(): string {
    return StorageKeys.definitionsRevisionCacheKey(
      Toggly._config?.appKey ?? '',
      Toggly._config?.environment ?? 'Production',
    );
  }

  private static get definitionsRevision(): string | null {
    if (Toggly._cachedDefinitionsRevision) {
      return Toggly._cachedDefinitionsRevision;
    }
    if (!Toggly._persistCache) {
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
    Toggly._refreshDebounceTimer = setTimeout(() => {
      Toggly._refreshDebounceTimer = null;
      if (forceJwksRefresh && Toggly._config.verifySignatures) {
        // Force re-fetch by clearing revision so signing key rotation always pulls fresh defs.
        Toggly._cachedDefinitionsRevision = null;
      }
      Toggly.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private static handleWsSyncMessage(message: WsSyncMessage): void {
    const previousRevision = Toggly.definitionsRevision;
    if (shouldFetchOnSync(message, previousRevision)) {
      Toggly.scheduleDebouncedRefresh();
    }
    if (message.etag) {
      Toggly.cacheDefinitionsRevision(message.etag);
    }
  }

  private static handleWsUpdateMessage(message: WsSyncMessage): void {
    if (shouldFetchOnSigningKeyUpdated(message)) {
      Toggly.scheduleDebouncedRefresh(true);
      return;
    }
    const previousRevision = Toggly.definitionsRevision;
    if (shouldFetchOnFlagsUpdated(message, previousRevision)) {
      Toggly.scheduleDebouncedRefresh();
    }
    if (message.etag) {
      Toggly.cacheDefinitionsRevision(message.etag);
    }
  }

  private static buildFetchHeaders(): HeadersInit {
    return buildDefinitionFetchHeaders(
      Toggly.definitionsRevision ? { 'If-None-Match': Toggly.definitionsRevision } : {},
    );
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
    return evaluationContextCacheKey(Toggly.evaluationContext);
  }

  private static get _flagsCacheKey(): string {
    return StorageKeys.flagsCacheKey(
      Toggly._config?.appKey ?? '',
      Toggly._config?.environment ?? 'Production',
      Toggly._contextCacheKey,
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

  private static _getFallbackFlags(): { [key: string]: boolean } {
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
    Toggly._lastError = undefined;
    Toggly._cachedDefinitionsRevision = null;
    Toggly._wsReconnectAttempt = 0;

    // Register initial hooks
    if (Toggly._config.hooks) {
      Toggly._config.hooks.forEach(hook => Toggly._hookExecutor.addHook(hook));
    }

    if (Toggly._config.localGates) {
      Toggly.setLocalGates(Toggly._config.localGates);
    }

    if (!Toggly.identity) {
      Toggly.identity = uuidv4();
    }

    Toggly.startRefreshInterval();
    Toggly.startWebSocket();

    return Toggly.refresh();
  }

  static get featureFlagsValue(): { [key: string]: boolean } {
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

  static get identity(): string {
    if (!canUseStorage) return '';
    return localStorage.getItem(StorageKeys.identityKey) ?? '';
  }

  static set identity(v: string) {
    const dataMapPromise = Toggly._hookExecutor.executeBeforeIdentify(v);
    if (canUseStorage) {
      localStorage.setItem(StorageKeys.identityKey, v);
    }
    Promise.resolve(dataMapPromise).then(dataMap =>
      Toggly._hookExecutor.executeAfterIdentify(v, dataMap)
    ).catch(err => console.error('[Toggly] Hook execution error:', err));
  }

  static clearIdentity() {
    const currentIdentity = Toggly.identity;
    if (currentIdentity) {
      const dataMapPromise = Toggly._hookExecutor.executeBeforeIdentify('');
      if (canUseStorage) {
        localStorage.removeItem(StorageKeys.identityKey);
      }
      Promise.resolve(dataMapPromise).then(dataMap =>
        Toggly._hookExecutor.executeAfterIdentify('', dataMap)
      ).catch(err => console.error('[Toggly] Hook execution error:', err));
    } else if (canUseStorage) {
      localStorage.removeItem(StorageKeys.identityKey);
    }
  }

  static get groups(): string[] {
    if (!canUseStorage) return [];
    try {
      return JSON.parse(localStorage.getItem(StorageKeys.groupsKey) ?? '[]');
    } catch {
      return [];
    }
  }

  static set groups(values: string[]) {
    if (!canUseStorage) return;
    localStorage.setItem(StorageKeys.groupsKey, JSON.stringify(values ?? []));
  }

  static get claims(): Record<string, string> {
    if (!canUseStorage) return {};
    try {
      return JSON.parse(localStorage.getItem(StorageKeys.claimsKey) ?? '{}');
    } catch {
      return {};
    }
  }

  static set claims(values: Record<string, string>) {
    if (!canUseStorage) return;
    localStorage.setItem(StorageKeys.claimsKey, JSON.stringify(values ?? {}));
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
    if (context.identity !== undefined) {
      if (context.identity) {
        Toggly.identity = context.identity;
      } else {
        Toggly.clearIdentity();
      }
    }
    if (context.groups !== undefined) {
      Toggly.groups = context.groups;
    }
    if (context.claims !== undefined) {
      Toggly.claims = context.claims;
    }
    Toggly._inMemoryFlags = null;
    Toggly._hasLoadedFlags = false;
    return Toggly.refresh();
  }

  static clearContext(): Promise<{ [key: string]: boolean }> {
    Toggly.clearIdentity();
    Toggly.groups = [];
    Toggly.claims = {};
    Toggly._inMemoryFlags = null;
    Toggly._hasLoadedFlags = false;
    return Toggly.refresh();
  }

  private static buildEvaluatedUrl(mode: 'evaluated' | 'variants'): string {
    const path = mode === 'variants' ? 'evaluated-variants-signed' : 'evaluated-signed';
    const url = new URL(
      `${Toggly._config.baseURI}/${path}/${Toggly._config.appKey}/${Toggly._config.environment}`
    );
    appendEvaluationContext(url, Toggly.evaluationContext, mode);
    return url.toString();
  }

  private static get _cachedFeatureFlags(): { [key: string]: boolean } | null {
    if (!Toggly._persistCache) return null;
    try {
      const raw = localStorage.getItem(Toggly._flagsCacheKey);
      const parsed = JSON.parse(raw ?? 'null') as { [key: string]: boolean } | null;
      if (raw != null && parsed != null) {
        Toggly._touchCacheKey(Toggly._flagsCacheKey);
      }
      return parsed;
    } catch (error) {
      Toggly._reportError('Error reading cached feature flags', error);
      return null;
    }
  }

  static cacheFeatureFlags(flags: { [key: string]: boolean }) {
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
    if (Toggly._persistCache) {
      try {
        const raw = localStorage.getItem(Toggly._variantsCacheKey);
        const parsed = JSON.parse(raw ?? 'null') as { [key: string]: EvaluatedVariantDef } | null;
        if (raw != null && parsed != null) {
          Toggly._touchCacheKey(Toggly._variantsCacheKey);
        }
        return parsed;
      } catch { return null; }
    }
    return null;
  }

  static cacheVariants(variants: { [key: string]: EvaluatedVariantDef }) {
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
    const variants = Toggly.variantsValue;
    if (!variants) return null;
    const entry = variants[featureKey];
    if (!entry || !entry.variant) return null;
    if (!Toggly._isEffectiveFlagEnabled(featureKey, entry.enabled === true)) {
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

    return new Promise((resolve) => {
      const url = Toggly.buildEvaluatedUrl('evaluated');

      // Wrap the fetch invocation in a resolved Promise so that any synchronous
      // failure (e.g. a non-conforming fetch implementation returning undefined)
      // is funneled through the same .catch handler as a real network error.
      Promise.resolve()
        .then(() => fetch(url, { headers: Toggly.buildFetchHeaders() }))
        .then((response) => {
          Toggly.applyFetchRevision(response);
          if (response.status === 304) {
            const flags = Toggly._getFallbackFlags();
            resolve(flags);
            return null;
          }
          if (!response.ok) {
            throw new Error(`Failed to fetch feature flags: ${response.status} ${response.statusText}`);
          }
          return response.json();
        })
        .then((payload) => {
          if (!payload) {
            const flags = Toggly._getFallbackFlags();
            resolve(flags);
            return;
          }
          const flags = (payload && payload.defs) ? payload.defs : payload;
          Toggly.cacheFeatureFlags(flags);
          resolve(flags);

          if (Toggly._config.isDebug) { console.log(`Toggly.fetchFeatureFlags - ${JSON.stringify(flags)}`); }
        })
        .catch((error) => {
          Toggly._reportError('Error fetching feature flags', error);
          var flags = Toggly._getFallbackFlags();
          resolve(flags);

          if (Toggly._config.isDebug) { console.log(`Toggly.loadedFromCache - ${JSON.stringify(flags)}`); }
        });
    });
  }

  private static fetchFeatureFlagsWithVariants(): Promise<{ [key: string]: boolean }> {
    return new Promise((resolve) => {
      const url = Toggly.buildEvaluatedUrl('variants');

      Promise.resolve()
        .then(() => fetch(url, { headers: Toggly.buildFetchHeaders() }))
        .then((response) => {
          Toggly.applyFetchRevision(response);
          if (response.status === 304) {
            const flags = Toggly._getFallbackFlags();
            resolve(flags);
            return null;
          }
          if (!response.ok) {
            throw new Error(`Failed to fetch feature flags: ${response.status} ${response.statusText}`);
          }
          return response.json();
        })
        .then((payload) => {
          if (!payload) {
            const flags = Toggly._getFallbackFlags();
            resolve(flags);
            return;
          }
          const defs: { [key: string]: EvaluatedVariantDef } = (payload && payload.defs) ? payload.defs : payload;
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
          Toggly._reportError('Error fetching feature flags', error);
          const flags = Toggly._getFallbackFlags();
          resolve(flags);

          if (Toggly._config.isDebug) { console.log(`Toggly.loadedFromCache - ${JSON.stringify(flags)}`); }
        });
    });
  }

  static refresh(): Promise<{ [key: string]: boolean }> {
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
      Promise.resolve(Toggly._hookExecutor.executeAfterRefresh(flags))
        .catch(err => console.error('[Toggly] Hook execution error:', err));
      return flags;
    });
  }

  private static _getEffectiveFlagValue(flags: { [key: string]: boolean }, flagKey: string): boolean {
    const remote = flags[flagKey] === true;
    return applyLocalGate(remote, flagKey, Toggly._localGates, Toggly._localGateIndex);
  }

  private static _isEffectiveFlagEnabled(flagKey: string, remote: boolean): boolean {
    return applyLocalGate(remote, flagKey, Toggly._localGates, Toggly._localGateIndex);
  }

  private static _evaluateFeatureGate(flags: { [key: string]: boolean } = {}, featureGate: string[], requirement: FeatureRequirement = FeatureRequirement.all, negate: boolean = false) {
    if (featureGate.length > 0 && Object.keys(flags).length === 0) {
      return negate;
    }

    var isEnabled: boolean;

    if (requirement === FeatureRequirement.any) {
      isEnabled = featureGate.reduce((isEnabled, featureKey) => {
        return isEnabled ||
          Toggly._getEffectiveFlagValue(flags, featureKey);
      }, false);
    } else {
      isEnabled = featureGate.reduce((isEnabled, featureKey) => {
        return isEnabled &&
          Toggly._getEffectiveFlagValue(flags, featureKey);
      }, true);
    }

    if (Toggly._config.isDebug) { console.log(`Toggly._evaluateFeatureGate - ${JSON.stringify(featureGate)}`); }

    isEnabled = negate ? !isEnabled : isEnabled;

    return isEnabled;
  }

  static evaluateFeatureGate(featureGate: string[], requirement: FeatureRequirement = FeatureRequirement.all, negate: boolean = false): boolean {
    if (featureGate.length === 0) {
      return Toggly._evaluateFeatureGate(Toggly.featureFlagsValue, featureGate, requirement, negate);
    }
    
    const firstKey = featureGate[0];
    const dataMapPromise = Toggly._hookExecutor.executeBeforeEvaluation(firstKey);
    const result = Toggly._evaluateFeatureGate(Toggly.featureFlagsValue, featureGate, requirement, negate);
    Promise.resolve(dataMapPromise).then(dataMap =>
      Toggly._hookExecutor.executeAfterEvaluation(firstKey, dataMap, result)
    ).catch(err => console.error('[Toggly] Hook execution error:', err));
    
    return result;
  }

  static isFeatureOn(featureKey: string): boolean {
    const dataMapPromise = Toggly._hookExecutor.executeBeforeEvaluation(featureKey);
    const result = Toggly._evaluateFeatureGate(Toggly.featureFlagsValue, [featureKey]);
    Promise.resolve(dataMapPromise).then(dataMap => 
      Toggly._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result)
    ).catch(err => console.error('[Toggly] Hook execution error:', err));
    return result;
  }

  static isFeatureOff(featureKey: string): boolean {
    const dataMapPromise = Toggly._hookExecutor.executeBeforeEvaluation(featureKey);
    const result = Toggly._evaluateFeatureGate(Toggly.featureFlagsValue, [featureKey], FeatureRequirement.all, true);
    Promise.resolve(dataMapPromise).then(dataMap => 
      Toggly._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result)
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

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      Toggly._wsConnected = true;
      Toggly._wsReconnectAttempt = 0;
      Toggly._lastFallbackRefresh = Date.now();
      if (Toggly._config.isDebug) { console.log('[Toggly] WebSocket connected'); }
    };

    ws.onmessage = (event) => {
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
      Toggly._wsConnected = false;
      Toggly._ws = null;
      const delay = getNextReconnectDelayMs(Toggly._wsReconnectAttempt);
      Toggly._wsReconnectAttempt += 1;
      if (Toggly._config.isDebug) { console.log(`[Toggly] WebSocket closed, reconnecting in ${delay}ms`); }

      Toggly._wsReconnectTimer = setTimeout(() => {
        Toggly.startWebSocket();
      }, delay);
    };

    ws.onerror = (error) => {
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

  static cancelRefreshInterval() {
    window.clearInterval(Toggly._refreshInterval);
    Toggly._refreshInterval = undefined;
    Toggly.stopWebSocket();
  }

  static startRefreshInterval() {
    Toggly.cancelRefreshInterval();

    if (Toggly._config.appKey && Toggly._config.featureFlagsRefreshInterval > 0) {
      Toggly._refreshInterval = window.setInterval(() => {
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
