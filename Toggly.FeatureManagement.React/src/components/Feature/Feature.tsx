import React from 'react'
import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types'
import { context } from '../../contexts'
import type { TogglyService } from '../../services'

type FeatureProps = {
  featureKey?: string
  featureKeys?: string[]
  /** When set (with {@link featureKey}), children render only if the assigned variant name matches. */
  variant?: string
  requirement?: string
  negate?: boolean
  /** Entity instance or canonical {@link TogglyEntityContext} for entity-gated flags. */
  context?: TogglyEntityContext | Record<string, unknown> | null
  /** Context kind for {@link registerContext} mapper lookup when `context` is a domain object. */
  contextKind?: string
  children?: React.ReactNode
  /**
   * @deprecated Off-path content: use a separate `<Feature negate>` instead.
   * Still accepted for one release; prefer `negate`.
   */
  fallback?: React.ReactNode
  /** Render prop for conditional styling; always invoked with resolved gate boolean. */
  render?: (enabled: boolean) => React.ReactNode
}

class Feature extends React.Component<FeatureProps, { shouldShow: boolean }> {
  static contextType = context
  context!: React.ContextType<typeof context>
  private subscribedService?: TogglyService
  private mounted = false
  private evaluation = 0
  private unsubscribeRefresh: (() => void) | undefined
  private unsubscribeLocalGates: (() => void) | undefined

  constructor(props: FeatureProps) {
    super(props)
    this.state = { shouldShow: false }
  }

  private buildGate(): string[] {
    var gate: string[] = []
    if (this.props.featureKey) {
      gate.push(this.props.featureKey)
    }
    if (this.props.featureKeys) {
      gate = gate.concat(this.props.featureKeys as string[])
    }
    return gate
  }

  private applyVariantFilter(isEnabled: boolean): boolean {
    const { variant, featureKey } = this.props
    if (!isEnabled || variant == null || variant === '') {
      return isEnabled
    }
    if (!featureKey) {
      return false
    }
    const toggly = this.context.toggly
    const assigned = toggly?._getVariantSnapshot
      ? toggly._getVariantSnapshot(featureKey)
      : toggly?.getVariant(featureKey)
    return assigned?.name === variant
  }

  private runGate = () => {
    const gate = this.buildGate()
    if (gate.length === 0 || !this.context.toggly) {
      return
    }
    const service = this.context.toggly
    const evaluation = ++this.evaluation
    service
      .evaluateFeatureGate(
        gate,
        this.props.requirement ?? 'all',
        this.props.negate ?? false,
        this.props.context,
        this.props.contextKind,
      )
      .then((isEnabled) => {
        if (this.mounted && this.evaluation === evaluation && this.context.toggly === service) {
          this.setState({ shouldShow: this.applyVariantFilter(isEnabled) })
        }
      })
  }

  private bindService() {
    if (this.subscribedService === this.context.toggly) return
    this.unsubscribeRefresh?.()
    this.unsubscribeLocalGates?.()
    this.subscribedService = this.context.toggly
    this.unsubscribeRefresh = this.subscribedService?.subscribeFeaturesRefresh(this.runGate)
    this.unsubscribeLocalGates = this.subscribedService?.subscribeLocalGatesChanged(this.runGate)
  }

  componentDidMount() {
    this.mounted = true
    this.bindService()
    if (this.buildGate().length === 0) {
      this.setState({ shouldShow: !(this.props.negate ?? false) })
      return
    }
    this.runGate()
  }

  componentDidUpdate(prevProps: FeatureProps) {
    const serviceChanged = this.subscribedService !== this.context.toggly
    this.bindService()
    const gateChanged =
      prevProps.featureKey !== this.props.featureKey ||
      prevProps.featureKeys !== this.props.featureKeys
    const contextChanged =
      prevProps.context !== this.props.context ||
      prevProps.contextKind !== this.props.contextKind
    if (
      serviceChanged ||
      gateChanged ||
      contextChanged ||
      prevProps.requirement !== this.props.requirement ||
      prevProps.negate !== this.props.negate ||
      prevProps.variant !== this.props.variant
    ) {
      this.runGate()
    }
  }

  componentWillUnmount() {
    this.mounted = false
    this.evaluation++
    this.subscribedService = undefined
    this.unsubscribeRefresh?.()
    this.unsubscribeLocalGates?.()
    this.unsubscribeRefresh = undefined
    this.unsubscribeLocalGates = undefined
  }

  render() {
    if (this.props.render) {
      return <>{this.props.render(this.state.shouldShow)}</>
    }

    // Off path: prefer a separate <Feature negate>. `fallback` is deprecated.
    if (this.state.shouldShow) {
      return this.props.children
    }
    if (this.props.fallback != null) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(
          '[Toggly] Feature `fallback` is deprecated. Use a separate <Feature negate> for the off path.',
        )
      }
      return this.props.fallback
    }
    return null
  }
}

export default Feature
