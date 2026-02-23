import type { Hook } from '@ops-ai/toggly-hooks-types';
import { HookExecutor } from './hooks';

export interface TogglyOptions {
  baseURI?: string
  verifySignatures?: boolean
  appKey?: string
  environment?: string
  identity?: string
  featureDefaults?: { [key: string]: boolean }
  showFeatureDuringEvaluation?: boolean
  featureFlagsRefreshInterval?: number
  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[]
}

export interface TogglyService {
  shouldShowFeatureDuringEvaluation: boolean
  _loadFeatures: () => Promise<{ [key: string]: boolean } | null>
  _featuresLoaded: () => Promise<{ [key: string]: boolean } | null>
  _evaluateFeatureGate: (
    gate: string[],
    requirement: string,
    negate: boolean,
  ) => Promise<boolean>
  evaluateFeatureGate: (
    featureKeys: string[],
    requirement: string,
    negate: boolean,
  ) => Promise<boolean>
  isFeatureOn: (featureKey: string) => Promise<boolean>
  isFeatureOff: (featureKey: string) => Promise<boolean>
  refreshFlags: () => Promise<void>
  addHook: (hook: Hook) => void
  removeHook: (name: string) => boolean
}

export class Toggly implements TogglyService {
  private _config: TogglyOptions = {
    baseURI: 'https://definitions.toggly.io',
    verifySignatures: false,
    showFeatureDuringEvaluation: false,
    featureFlagsRefreshInterval: 3 * 60 * 1000, // 3 minutes
    hooks: []
  }
  private _features: { [key: string]: boolean } | null = null
  private _loadingFeatures: boolean = false
  private _lastFetchTime: number = 0
  private _hookExecutor = new HookExecutor()

  shouldShowFeatureDuringEvaluation: boolean = false

  constructor(config: TogglyOptions) {
    if (!config.appKey) {
      if (config.featureDefaults) {
        this._features = config.featureDefaults ?? {}

        console.warn(
          'Toggly --- Using feature defaults as no application key provided when initializing the Toggly',
        )
      } else {
        console.warn(
          'Toggly --- A valid application key is required to connect to your Toggly.io application for evaluating your features.',
        )
      }
    } else {
      if (!config.environment) {
        config.environment = 'Production'

        console.warn(
          'Toggly --- Using Production environment as no environment provided when initializing the Toggly',
        )
      }
    }

    this._config = Object.assign({}, this._config, config)
    this.shouldShowFeatureDuringEvaluation = this._config.showFeatureDuringEvaluation ?? false
    
    // Register initial hooks
    if (this._config.hooks) {
      this._config.hooks.forEach(hook => this._hookExecutor.addHook(hook))
    }
  }

  _loadFeatures = async () => {
    // Features are currently being loaded
    if (this._loadingFeatures) {
      await new Promise<void>((resolve) => {
        const checkIfApiCallFinished = () => {
          if (!this._loadingFeatures) {
            resolve()
          } else {
            setTimeout(checkIfApiCallFinished, 100)
          }
        }
        checkIfApiCallFinished()
      })
    }

    // Check if cache is still valid
    const now = Date.now()
    const cacheAge = now - this._lastFetchTime
    const refreshInterval = this._config.featureFlagsRefreshInterval ?? 3 * 60 * 1000

    if (this._features !== null && cacheAge < refreshInterval) {
      return this._features
    }

    // Features already loaded and cache is valid
    if (this._features !== null && cacheAge < refreshInterval) {
      return this._features
    }

    this._loadingFeatures = true

    try {
      var url = `${this._config.baseURI}/evaluated-signed/${this._config.appKey}/${this._config.environment}`

      if (this._config.identity) {
        url += `?u=${this._config.identity}`
      }

      const response = await fetch(url)
      const payload = await response.json()
      this._features = payload?.defs ?? payload
      this._lastFetchTime = Date.now()
      
      // Trigger afterRefresh hooks
      if (this._features) {
        this._hookExecutor.executeAfterRefresh(this._features)
      }
    } catch (error) {
      // If we have cached features, use them; otherwise use defaults
      if (this._features === null) {
        this._features = this._config.featureDefaults ?? {}
      }
      console.warn(
        'Toggly --- Using feature defaults or cached values as features could not be loaded from the Toggly API',
      )
    } finally {
      this._loadingFeatures = false
    }

    return this._features
  }

  _featuresLoaded = async () => {
    return this._features ?? (await this._loadFeatures())
  }

  _evaluateFeatureGate = async (
    gate: string[],
    requirement = 'all',
    negate = false,
  ) => {
    await this._featuresLoaded()

    if (!this._features || Object.keys(this._features).length === 0) {
      return true
    }

    var isEnabled: boolean

    if (requirement === 'any') {
      isEnabled = gate.reduce((isEnabled: any, featureKey: string | number) => {
        return (
          isEnabled ||
          (this._features![featureKey] && this._features![featureKey] === true)
        )
      }, false)
    } else {
      isEnabled = gate.reduce((isEnabled: any, featureKey: string | number) => {
        return (
          isEnabled &&
          this._features![featureKey] &&
          this._features![featureKey] === true
        )
      }, true)
    }

    isEnabled = negate ? !isEnabled : isEnabled

    return isEnabled
  }

  evaluateFeatureGate = async (
    featureKeys: string[],
    requirement = 'all',
    negate = false,
  ) => {
    // For gate evaluation, we call hooks with the first key as representative
    // This is a simplified approach - gates evaluate multiple flags together
    if (featureKeys.length > 0) {
      const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKeys[0])
      const result = await this._evaluateFeatureGate(featureKeys, requirement, negate)
      await this._hookExecutor.executeAfterEvaluation(featureKeys[0], dataMap, result)
      return result
    }
    return await this._evaluateFeatureGate(featureKeys, requirement, negate)
  }

  isFeatureOn = async (featureKey: string) => {
    const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKey)
    const result = await this._evaluateFeatureGate([featureKey])
    await this._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result)
    return result
  }

  isFeatureOff = async (featureKey: string) => {
    const dataMap = await this._hookExecutor.executeBeforeEvaluation(featureKey)
    const result = await this._evaluateFeatureGate([featureKey], 'all', true)
    await this._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result)
    return result
  }

  refreshFlags = async (): Promise<void> => {
    this._lastFetchTime = 0 // Force refresh
    await this._loadFeatures()
  }

  /**
   * Add a hook dynamically
   */
  addHook(hook: Hook): void {
    this._hookExecutor.addHook(hook)
  }

  /**
   * Remove a hook by name
   * @returns true if hook was found and removed, false otherwise
   */
  removeHook(name: string): boolean {
    return this._hookExecutor.removeHook(name)
  }
}

export default Toggly
