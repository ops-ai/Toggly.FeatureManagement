import { Injectable } from '@angular/core'
import { ITogglyOptions, ITogglyService } from './models'
import { TogglyOptions } from './toggly-options'

@Injectable({
  providedIn: 'root',
})
export class TogglyService implements ITogglyService {
  private _features: { [key: string]: boolean } | null = null
  private _loadingFeatures: boolean = false

  shouldShowFeatureDuringEvaluation: boolean = false

  constructor(private readonly _config: TogglyOptions) {
    if (!this._config.appKey) {
      if (this._config.featureDefaults) {
        this._features = this._config.featureDefaults ?? {}

        console.warn(
          'Toggly --- Using feature defaults as no application key provided when initializing the Toggly',
        )
      } else {
        console.warn(
          'Toggly --- A valid application key is required to connect to your Toggly.io application for evaluating your features.',
        )
      }
    } else {
      if (!this._config.environment) {
        console.warn(
          'Toggly --- Using Production environment as no environment provided when initializing the Toggly',
        )
      }
    }

    this.shouldShowFeatureDuringEvaluation =
      this._config.showFeatureDuringEvaluation ?? false
  }

  private _loadFeatures = async () => {
    // Feature are currently being loaded
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

    // Features already loaded
    if (this._features !== null) {
      return this._features
    }

    this._loadingFeatures = true

    try {
      var url = `${this._config.baseURI ?? 'https://client.toggly.io'}/${this._config.appKey}-${this._config.environment ?? 'Production'}/defs`

      if (this._config.identity) {
        url += `?u=${this._config.identity}`
      }

      const response = await fetch(url)
      this._features = await response.json()
    } catch (error) {
      this._features = this._config.featureDefaults ?? {}
      console.warn(
        'Toggly --- Using feature defaults as features could not be loaded from the Toggly API',
      )
    } finally {
      this._loadingFeatures = false
    }

    return this._features
  }

  private _featuresLoaded = async () => {
    return this._features ?? (await this._loadFeatures())
  }

  private _evaluateFeatureGate = async (
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
    return await this._evaluateFeatureGate(featureKeys, requirement, negate)
  }

  isFeatureOn = async (featureKey: string) => {
    return await this._evaluateFeatureGate([featureKey])
  }

  isFeatureOff = async (featureKey: string) => {
    return await this._evaluateFeatureGate([featureKey], 'all', true)
  }
}
