import { v4 as uuidv4 } from 'uuid';
import { FeatureRequirement, StorageKeys, TogglyConfig, VariantResult, EvaluatedVariantDef } from './models';
import { HookExecutor } from './hooks';
import type { Hook } from '@ops-ai/toggly-hooks-types';

const canUseStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export class Toggly {
  private static _config: TogglyConfig;
  private static _refreshInterval: number | undefined;
  private static _hookExecutor = new HookExecutor();

  static _ws: WebSocket | null = null;
  static _wsConnected: boolean = false;
  static _wsReconnectTimer: any = null;
  static _lastFallbackRefresh: number = 0;
  static _fallbackRefreshInterval: number = 20 * 60 * 1000;

  private static get _persistCache(): boolean {
    return Toggly._config?.persistCache !== false && canUseStorage;
  }

  private static get _flagsCacheKey(): string {
    return StorageKeys.flagsCacheKey(
      Toggly._config?.appKey ?? '',
      Toggly._config?.environment ?? 'Production',
    );
  }

  private static get _variantsCacheKey(): string {
    return StorageKeys.variantsCacheKey(
      Toggly._config?.appKey ?? '',
      Toggly._config?.environment ?? 'Production',
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

    // Register initial hooks
    if (Toggly._config.hooks) {
      Toggly._config.hooks.forEach(hook => Toggly._hookExecutor.addHook(hook));
    }

    if (!Toggly.identity) {
      Toggly.identity = uuidv4();
    }

    Toggly.startRefreshInterval();
    Toggly.startWebSocket();

    return Toggly.refresh();
  }

  static get featureFlagsValue(): { [key: string]: boolean } {
    if (Toggly._persistCache) {
      try {
        var cachedFlags = JSON.parse(localStorage.getItem(Toggly._flagsCacheKey) ?? 'null');
        if (Toggly._config?.appKey && cachedFlags) return cachedFlags;
      } catch { /* corrupt cache — fall through */ }
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

  private static get _cachedFeatureFlags(): { [key: string]: boolean } | null {
    if (!Toggly._persistCache) return null;
    try {
      return JSON.parse(localStorage.getItem(Toggly._flagsCacheKey) ?? 'null');
    } catch { return null; }
  }

  static cacheFeatureFlags(flags: { [key: string]: boolean }) {
    if (!Toggly._persistCache) return;
    try {
      localStorage.setItem(Toggly._flagsCacheKey, JSON.stringify(flags));
    } catch { /* storage full or unavailable */ }
  }

  static clearFeatureFlagsCache() {
    if (!canUseStorage) return;
    try {
      localStorage.removeItem(Toggly._flagsCacheKey);
      localStorage.removeItem(Toggly._variantsCacheKey);
    } catch { /* ignore */ }
  }

  static get variantsValue(): { [key: string]: EvaluatedVariantDef } | null {
    if (!Toggly._config?.enableVariants) return null;
    if (Toggly._persistCache) {
      try {
        return JSON.parse(localStorage.getItem(Toggly._variantsCacheKey) ?? 'null');
      } catch { return null; }
    }
    return null;
  }

  static cacheVariants(variants: { [key: string]: EvaluatedVariantDef }) {
    if (!Toggly._persistCache) return;
    try {
      localStorage.setItem(Toggly._variantsCacheKey, JSON.stringify(variants));
    } catch { /* storage full or unavailable */ }
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
      var url = `${Toggly._config.baseURI}/evaluated-signed/${Toggly._config.appKey}/${Toggly._config.environment}`;

      if (Toggly.identity) {
        url += `?u=${Toggly.identity}`;
      }

      // Wrap the fetch invocation in a resolved Promise so that any synchronous
      // failure (e.g. a non-conforming fetch implementation returning undefined)
      // is funneled through the same .catch handler as a real network error.
      Promise.resolve()
        .then(() => fetch(url))
        .then((response) => response.json())
        .then((payload) => {
          const flags = (payload && payload.defs) ? payload.defs : payload;
          Toggly.cacheFeatureFlags(flags);
          resolve(flags);

          if (Toggly._config.isDebug) { console.log(`Toggly.fetchFeatureFlags - ${JSON.stringify(flags)}`); }
        })
        .catch(() => {
          var flags = Toggly._cachedFeatureFlags ?? Toggly._config.flagDefaults;
          resolve(flags);

          if (Toggly._config.isDebug) { console.log(`Toggly.loadedFromCache - ${JSON.stringify(flags)}`); }
        });
    });
  }

  private static fetchFeatureFlagsWithVariants(): Promise<{ [key: string]: boolean }> {
    return new Promise((resolve) => {
      let url = `${Toggly._config.baseURI}/evaluated-variants-signed/${Toggly._config.appKey}/${Toggly._config.environment}`;
      const params = new URLSearchParams();

      if (Toggly.identity) {
        params.set('userId', Toggly.identity);
      }

      const queryString = params.toString();
      if (queryString) url += `?${queryString}`;

      Promise.resolve()
        .then(() => fetch(url))
        .then((response) => response.json())
        .then((payload) => {
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
        .catch(() => {
          const flags = Toggly._cachedFeatureFlags ?? Toggly._config.flagDefaults;
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

  private static _evaluateFeatureGate(flags: { [key: string]: boolean } = {}, featureGate: string[], requirement: FeatureRequirement = FeatureRequirement.all, negate: boolean = false) {
    var isEnabled: boolean;

    if (requirement === FeatureRequirement.any) {
      isEnabled = featureGate.reduce((isEnabled, featureKey) => {
        return isEnabled ||
          (flags[featureKey] && flags[featureKey] === true);
      }, false);
    } else {
      isEnabled = featureGate.reduce((isEnabled, featureKey) => {
        return isEnabled &&
          (flags[featureKey] && flags[featureKey] === true);
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

  static startWebSocket() {
    if (!Toggly._config.appKey) {
      return;
    }

    if (Toggly._config.enableLiveUpdates === false) {
      return;
    }

    Toggly.stopWebSocket();

    const wsUrl = Toggly._config.baseURI.replace('https://', 'wss://').replace('http://', 'ws://') + `/${Toggly._config.appKey}/ws`;

    if (Toggly._config.isDebug) { console.log(`[Toggly] WebSocket connecting to ${wsUrl}`); }

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      Toggly._wsConnected = true;
      Toggly._lastFallbackRefresh = Date.now();
      if (Toggly._config.isDebug) { console.log('[Toggly] WebSocket connected'); }
    };

    ws.onmessage = (event) => {
      const data = event.data;

      if (typeof data === 'string') {
        if (data === 'update' || data === 'flags-updated') {
          if (Toggly._config.isDebug) { console.log(`[Toggly] WebSocket received text: ${data}`); }
          Toggly.refresh();
          return;
        }

        try {
          const message = JSON.parse(data);
          if (message.type === 'ping') {
            return;
          }
          if (message.type === 'flags-updated' || message.type === 'update') {
            if (Toggly._config.isDebug) { console.log(`[Toggly] WebSocket received: ${message.type}`); }
            Toggly.refresh();
          }
        } catch (e) {
          if (Toggly._config.isDebug) { console.log(`[Toggly] WebSocket received unrecognized message: ${data}`); }
        }
      }
    };

    ws.onclose = () => {
      Toggly._wsConnected = false;
      Toggly._ws = null;
      if (Toggly._config.isDebug) { console.log('[Toggly] WebSocket closed, reconnecting in 5s'); }

      Toggly._wsReconnectTimer = setTimeout(() => {
        Toggly.startWebSocket();
      }, 5000);
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
