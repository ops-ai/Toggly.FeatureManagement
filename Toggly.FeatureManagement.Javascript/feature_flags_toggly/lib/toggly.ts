import { v4 as uuidv4 } from 'uuid';
import { FeatureRequirement, StorageKeys, TogglyConfig } from './models';
import { HookExecutor } from './hooks';
import type { Hook } from '@ops-ai/toggly-hooks-types';

export class Toggly {
  private static _config: TogglyConfig;
  private static _refreshInterval: number | undefined;
  private static _hookExecutor = new HookExecutor();

  static init(config: TogglyConfig = {} as TogglyConfig): Promise<{ [key: string]: boolean }> {
    Toggly._config = Object.assign({
      baseURI: 'https://client.toggly.io',
      reloadOnFeatureFlagValidation: false,
      connectTimeout: 5 * 1000,
      featureFlagsRefreshInterval: 3 * 60 * 1000,
      isDebug: false,
      environment: 'Production',
      flagDefaults: {},
      hooks: []
    }, config);

    // Register initial hooks
    if (Toggly._config.hooks) {
      Toggly._config.hooks.forEach(hook => Toggly._hookExecutor.addHook(hook));
    }

    if (!Toggly.identity) {
      Toggly.identity = uuidv4();
    }

    Toggly.clearFeatureFlagsCache();
    Toggly.startRefreshInterval();

    return Toggly.refresh();
  }

  static get featureFlagsValue(): { [key: string]: boolean } {
    var cachedFlags = JSON.parse(localStorage.getItem(StorageKeys.togglyFeatureFlagsKey.toString()) ?? null);
    return Toggly._config?.appKey && cachedFlags ? cachedFlags : Toggly._config?.flagDefaults ?? {};
  }

  static get identity(): string {
    return localStorage.getItem(StorageKeys.togglyIdentityKey.toString());
  }

  static set identity(v: string) {
    const dataMap = Toggly._hookExecutor.executeBeforeIdentify(v);
    localStorage.setItem(StorageKeys.togglyIdentityKey.toString(), v);
    Toggly._hookExecutor.executeAfterIdentify(v, dataMap);
  }

  static clearIdentity() {
    const currentIdentity = Toggly.identity;
    if (currentIdentity) {
      const dataMap = Toggly._hookExecutor.executeBeforeIdentify('');
      localStorage.removeItem(StorageKeys.togglyIdentityKey.toString());
      Toggly._hookExecutor.executeAfterIdentify('', dataMap);
    } else {
      localStorage.removeItem(StorageKeys.togglyIdentityKey.toString());
    }
  }

  private static get _cachedFeatureFlags(): { [key: string]: boolean } {
    return JSON.parse(localStorage.getItem(StorageKeys.togglyFeatureFlagsKey.toString()) ?? null);
  }

  static cacheFeatureFlags(flags: { [key: string]: boolean }) {
    localStorage.setItem(StorageKeys.togglyFeatureFlagsKey.toString(), JSON.stringify(flags));
  }

  static clearFeatureFlagsCache() {
    localStorage.removeItem(StorageKeys.togglyFeatureFlagsKey.toString());
  }

  static fetchFeatureFlags(): Promise<{ [key: string]: boolean }> {
    return new Promise((resolve, reject) => {
      var url = `${Toggly._config.baseURI}/${Toggly._config.appKey}-${Toggly._config.environment}/defs`;

      if (Toggly.identity) {
        url += `?u=${Toggly.identity}`;
      }

      fetch(url)
        .then((response) => response.json())
        .then((flags) => {
          // Cache flags on successful response
          Toggly.cacheFeatureFlags(flags);
          resolve(flags);

          if (Toggly._config.isDebug) { console.log(`Toggly.fetchFeatureFlags - ${JSON.stringify(flags)}`); }
        })
        .catch((error) => {
          // Try to use flags from cache, otherwise use provided default flags
          var flags = Toggly._cachedFeatureFlags ?? Toggly._config.flagDefaults;
          resolve(flags);

          if (Toggly._config.isDebug) { console.log(`Toggly.loadedFromCache - ${JSON.stringify(flags)}`); }
        });
    });
  }

  static refresh(): Promise<{ [key: string]: boolean }> {
    if (Toggly._config.isDebug) { console.log('Toggly.refresh'); }

    // In case there is no API key provided, only the flag defaults shall be used
    if (!Toggly._config.appKey) {
      if (Toggly._config.isDebug) { console.log(`Toggly.usedFlagDefaults - ${JSON.stringify(Toggly._config.flagDefaults)}`); }

      return new Promise((resolve, reject) => {
        resolve(Toggly._config.flagDefaults);
      });
    }

    // Try to fetch flags from the API
    return Toggly.fetchFeatureFlags().then(flags => {
      Toggly._hookExecutor.executeAfterRefresh(flags);
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
    const result = Toggly._evaluateFeatureGate(Toggly.featureFlagsValue, featureGate, requirement, negate);
    
    // Execute hooks for each flag in the gate
    featureGate.forEach(key => {
      const dataMap = Toggly._hookExecutor.executeBeforeEvaluation(key);
      const flagValue = Toggly.featureFlagsValue[key] || false;
      Toggly._hookExecutor.executeAfterEvaluation(key, dataMap, flagValue);
    });
    
    return result;
  }

  static isFeatureOn(featureKey: string): boolean {
    const dataMap = Toggly._hookExecutor.executeBeforeEvaluation(featureKey);
    const result = Toggly._evaluateFeatureGate(Toggly.featureFlagsValue, [featureKey]);
    Toggly._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result);
    return result;
  }

  static isFeatureOff(featureKey: string): boolean {
    const dataMap = Toggly._hookExecutor.executeBeforeEvaluation(featureKey);
    const result = Toggly._evaluateFeatureGate(Toggly.featureFlagsValue, [featureKey], FeatureRequirement.all, true);
    Toggly._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result);
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

  static cancelRefreshInterval() {
    window.clearInterval(Toggly._refreshInterval);
    Toggly._refreshInterval = undefined;
  }

  static startRefreshInterval() {
    Toggly.cancelRefreshInterval();

    if (Toggly._config.appKey && Toggly._config.featureFlagsRefreshInterval > 0) {
      Toggly._refreshInterval = window.setInterval(() => Toggly.refresh(), Toggly._config.featureFlagsRefreshInterval);
    }
  }
}

(window as any).Toggly = Toggly;

