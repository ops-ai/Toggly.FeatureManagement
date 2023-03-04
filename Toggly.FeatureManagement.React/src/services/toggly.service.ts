export interface TogglyOptions {
  baseURI?: string
  appKey?: string
  environment?: string
  identity?: string
  featureDefaults?: { [key: string]: boolean }
  showFeatureDuringEvaluation?: boolean
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
}

export class Toggly implements TogglyService {
  private _config: TogglyOptions = {
    baseURI: 'https://client.toggly.io',
    showFeatureDuringEvaluation: false,
  }
  private _features: { [key: string]: boolean } | null = null
  private _loadingFeatures: boolean = false

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

    this.shouldShowFeatureDuringEvaluation = this._config.showFeatureDuringEvaluation!
  }

  _loadFeatures = async () => {
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
      var url = `${this._config.baseURI}/${this._config.appKey}-${this._config.environment}/defs`

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
    return await this._evaluateFeatureGate(featureKeys, requirement, negate)
  }

  isFeatureOn = async (featureKey: string) => {
    return await this._evaluateFeatureGate([featureKey])
  }

  isFeatureOff = async (featureKey: string) => {
    return await this._evaluateFeatureGate([featureKey], 'all', true)
  }
}

export default Toggly
