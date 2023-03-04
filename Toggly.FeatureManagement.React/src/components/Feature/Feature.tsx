import React from 'react'
import { context } from '../../contexts'

type FeatureProps = {
  featureKey?: string
  featureKeys?: string[]
  requirement?: string
  negate?: boolean
  children: React.ReactNode
}

class Feature extends React.Component<
  FeatureProps,
  { gate: string[]; shouldShow: boolean }
> {
  static contextType = context
  context!: React.ContextType<typeof context>

  constructor(props: FeatureProps) {
    super(props)

    var gate = []
    if (props.featureKey) {
      gate.push(props.featureKey)
    }

    if (props.featureKeys) {
      gate = gate.concat(props.featureKeys as string[])
    }

    this.state = { gate, shouldShow: false }
  }

  componentDidMount() {
    this.state.gate.length > 0
      ? this.context
          .toggly!.evaluateFeatureGate(
            this.state.gate,
            this.props.requirement ?? 'all',
            this.props.negate ?? false,
          )
          .then((isEnabled) => this.setState({ shouldShow: isEnabled }))
      : true
  }

  render() {
    return this.state.shouldShow ? this.props.children : null
  }
}

export default Feature
