import { Injectable, NgZone, OnDestroy } from '@angular/core'
import { ITogglyService } from './models'
import { TogglyOptions } from './toggly-options'
import { HookExecutor } from './hooks'
import type { Hook } from '@ops-ai/toggly-hooks-types'

@Injectable({
  providedIn: 'root',
})
export class TogglyService implements ITogglyService, OnDestroy {
  private _features: { [key: string]: boolean } | null = null
  private _loadingFeatures: boolean = false
  private _hookExecutor = new HookExecutor()

  private _ws: WebSocket | null = null
  private _wsConnected = false
  private _wsReconnectTimer: any = null
  private _lastFallbackRefresh = 0
  private readonly FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000
  private readonly WS_RECONNECT_DELAY = 5000

  shouldShowFeatureDuringEvaluation: boolean = false

  constructor(
    private readonly _config: TogglyOptions,
    private readonly _ngZone: NgZone,
  ) {
    if (!this._config.customDefinitionsUrl) {
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
    }

    this.shouldShowFeatureDuringEvaluation =
      this._config.showFeatureDuringEvaluation ?? false

    // Register initial hooks
    if (this._config.hooks) {
      this._config.hooks.forEach(hook => this._hookExecutor.addHook(hook))
    }
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

    // Features already loaded — apply polling throttle when WS is connected
    if (this._features !== null) {
      if (this._wsConnected) {
        const now = Date.now()
        if (now - this._lastFallbackRefresh < this.FALLBACK_REFRESH_INTERVAL) {
          return this._features
        }
      } else {
        return this._features
      }
    }

    const isInitialLoad = this._features === null

    this._loadingFeatures = true

    try {
      let url = this._config.customDefinitionsUrl
        ? this._config.customDefinitionsUrl
        : `${this._config.baseURI ?? 'https://definitions.toggly.io'}/evaluated-signed/${this._config.appKey}/${this._config.environment ?? 'Production'}`

      if (this._config.identity) {
        url += `?u=${this._config.identity}`
      }

      const response = await fetch(url)
      const payload = await response.json()
      this._features = payload?.defs ?? payload
      this._lastFallbackRefresh = Date.now()

      // Trigger afterRefresh hooks
      if (this._features) {
        this._hookExecutor.executeAfterRefresh(this._features)
      }

      // Start WebSocket after the initial feature load
      if (isInitialLoad) {
        this.startWebSocket()
      }
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

    let isEnabled: boolean

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

  private startWebSocket(): void {
    if (!this._config.appKey) {
      return
    }

    const baseURI = this._config.baseURI ?? 'https://definitions.toggly.io'
    const wsUrl = baseURI.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://') +
      `/${this._config.appKey}/ws`

    try {
      this._ws = new WebSocket(wsUrl)
    } catch (error) {
      console.warn('Toggly --- Failed to create WebSocket connection', error)
      return
    }

    this._ws.onopen = () => {
      this._ngZone.run(() => {
        this._wsConnected = true
      })
    }

    this._ws.onmessage = (event: MessageEvent) => {
      this._ngZone.run(() => {
        try {
          const data = JSON.parse(event.data)

          if (data.type === 'ping') {
            return
          }

          if (data.type === 'flags-updated' || data.type === 'update') {
            this._features = null
            this._loadFeatures()
          }
        } catch (error) {
          console.warn('Toggly --- Failed to parse WebSocket message', error)
        }
      })
    }

    this._ws.onclose = () => {
      this._ngZone.run(() => {
        this._wsConnected = false
        this._ws = null

        this._wsReconnectTimer = setTimeout(() => {
          this.startWebSocket()
        }, this.WS_RECONNECT_DELAY)
      })
    }

    this._ws.onerror = (error: Event) => {
      console.warn('Toggly --- WebSocket error', error)
    }
  }

  private stopWebSocket(): void {
    if (this._wsReconnectTimer) {
      clearTimeout(this._wsReconnectTimer)
      this._wsReconnectTimer = null
    }

    if (this._ws) {
      this._ws.onclose = null
      this._ws.close()
      this._ws = null
    }

    this._wsConnected = false
  }

  ngOnDestroy(): void {
    this.stopWebSocket()
  }
}
