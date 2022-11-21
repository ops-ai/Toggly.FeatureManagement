import { v4 as uuidv4 } from 'uuid';
import { FeatureRequirement, StorageKeys, TogglyConfig } from './models';

export class Toggly {
  private static _config: TogglyConfig;
  private static _refreshInterval: number | undefined;

  static init(config: TogglyConfig = {} as TogglyConfig): Promise<{ [key: string]: boolean }> {
    Toggly._config = Object.assign({
      baseURI: 'https://client.toggly.io',
      reloadOnFeatureFlagValidation: false,
      connectTimeout: 5 * 1000,
      featureFlagsRefreshInterval: 3 * 60 * 1000,
      isDebug: false,
      environment: 'Production',
      flagDefaults: {}
    }, config);

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
    localStorage.setItem(StorageKeys.togglyIdentityKey.toString(), v);
  }

  static clearIdentity() {
    localStorage.removeItem(StorageKeys.togglyIdentityKey.toString());
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
    return Toggly.fetchFeatureFlags();
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
    return Toggly._evaluateFeatureGate(Toggly.featureFlagsValue, featureGate, requirement, negate);
  }

  static isFeatureOn(featureKey: string): boolean {
    return Toggly._evaluateFeatureGate(Toggly.featureFlagsValue, [featureKey]);
  }

  static isFeatureOff(featureKey: string): boolean {
    return Toggly._evaluateFeatureGate(Toggly.featureFlagsValue, [featureKey], FeatureRequirement.all, true);
  }

  static cancelRefreshInterval() {
    window.clearInterval(Toggly._refreshInterval);
    Toggly._refreshInterval = undefined;
  }

  static startRefreshInterval() {
    Toggly.cancelRefreshInterval();

    if (Toggly._config.appKey) {
      Toggly._refreshInterval = window.setInterval(() => Toggly.refresh(), Toggly._config.featureFlagsRefreshInterval);
    }
  }
}

(window as any).Toggly = Toggly;

