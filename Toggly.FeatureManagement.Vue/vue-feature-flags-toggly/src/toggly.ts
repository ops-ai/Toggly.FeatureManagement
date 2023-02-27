export class Toggly {
  private _config: any = {
    baseURI: 'https://client.toggly.io',
    appKey: null,
    environment: null,
  }
  private _featureDefaults: { [key: string]: boolean } | null = null
  private _features: { [key: string]: boolean } | null = null
  private _loadingFeatures: boolean = false
  private _identity: String | null = null

  init = async (
    appKey: string,
    environment: string,
    identity: string,
    featureDefaults: { [key: string]: boolean } | null = null,
  ) => {
    if (!appKey) {
      if (featureDefaults) {
        this._features = featureDefaults

        console.warn(
          'Toggly --- Using feature defaults as no application key provided when initializing the Toggly',
        )
      } else {
        console.warn(
          'Toggly --- A valid application key is required to connect to your Toggly.io application for evaluating your features.',
        )
      }
    } else {
      if (!environment) {
        environment = 'Production'

        console.warn(
          'Toggly --- Using Production environment as no environment provided when initializing the Toggly',
        )
      }
    }

    this._config = Object.assign({}, this._config, {
      appKey,
      environment,
    })

    this._featureDefaults = featureDefaults

    if (!this._features) {
      await this._loadFeatures()
    }

    return this
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

      if (this._identity) {
        url += `?u=${this._identity}`
      }

      const response = await fetch(url)
      this._features = await response.json()
    } catch (error) {
      this._features = this._featureDefaults ?? {}
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

    var isEnabled

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

const toggly = new Toggly()

export default toggly
