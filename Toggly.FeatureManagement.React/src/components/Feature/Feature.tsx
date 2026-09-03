import React from 'react'
import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types'
import { context } from '../../contexts'

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
    const assigned = this.context.toggly?.getVariant(featureKey)
    return assigned?.name === variant
  }

  private runGate = () => {
    const gate = this.buildGate()
    if (gate.length === 0 || !this.context.toggly) {
      return
    }
    this.context.toggly
      .evaluateFeatureGate(
        gate,
        this.props.requirement ?? 'all',
        this.props.negate ?? false,
        this.props.context,
        this.props.contextKind,
      )
      .then((isEnabled) => this.setState({ shouldShow: this.applyVariantFilter(isEnabled) }))
  }

  componentDidMount() {
    const gate = this.buildGate()
    if (gate.length === 0) {
      this.setState({ shouldShow: !(this.props.negate ?? false) })
      return
    }
    if (this.context.toggly) {
      this.runGate()
      this.unsubscribeRefresh = this.context.toggly.subscribeFeaturesRefresh(this.runGate)
      this.unsubscribeLocalGates = this.context.toggly.subscribeLocalGatesChanged(this.runGate)
    }
  }

  componentDidUpdate(prevProps: FeatureProps) {
    const gateChanged =
      prevProps.featureKey !== this.props.featureKey ||
      prevProps.featureKeys !== this.props.featureKeys
    const contextChanged =
      prevProps.context !== this.props.context ||
      prevProps.contextKind !== this.props.contextKind
    if (
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
