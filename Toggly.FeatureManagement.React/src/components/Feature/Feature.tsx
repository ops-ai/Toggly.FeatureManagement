import React from 'react'
import { context } from '../../contexts'

type FeatureProps = {
  featureKey?: string
  featureKeys?: string[]
  /** When set (with {@link featureKey}), children render only if the assigned variant name matches. */
  variant?: string
  requirement?: string
  negate?: boolean
  children?: React.ReactNode
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
      .evaluateFeatureGate(gate, this.props.requirement ?? 'all', this.props.negate ?? false)
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
    if (
      gateChanged ||
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

    return this.state.shouldShow ? this.props.children : (this.props.fallback ?? null)
  }
}

export default Feature
