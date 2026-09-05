import { toProtobufTimestamp } from './grpc-clients.js'

export interface MetricsFeatureOptions {
  /** Optional feature key for experiment-style subcounts. */
  feature?: string
  /** Variant name (default: enabled). */
  variant?: string
}

export interface MetricsBatcherOptions {
  appKey: string
  environment: string
  instanceName?: string
}

type MetricKey = string // `${metric}\0${feature ?? ''}`

export interface MetricStatPayload {
  appKey: string
  environment: string
  time: { seconds: number; nanos: number }
  stats: Array<{
    metric: string
    feature?: string
    variantValues: Record<string, number>
  }>
  counters: Array<{
    metric: string
    feature?: string
    variantValues: Record<string, number>
  }>
  observations: Array<{
    time: { seconds: number; nanos: number }
    metric: string
    feature?: string
    variantValues: Record<string, number>
  }>
  instanceName?: string
}

/**
 * In-memory business metrics aggregator using variantValues maps (.NET parity).
 */
export class MetricsBatcher {
  private readonly appKey: string
  private readonly environment: string
  private readonly instanceName?: string
  private measures = new Map<MetricKey, Map<string, number>>()
  private counters = new Map<MetricKey, Map<string, number>>()
  private observations: Array<{
    time: Date
    metric: string
    feature?: string
    variant: string
    value: number
  }> = []

  constructor(options: MetricsBatcherOptions) {
    this.appKey = options.appKey
    this.environment = options.environment
    this.instanceName = options.instanceName
  }

  private key(metric: string, feature?: string): MetricKey {
    return `${metric}\0${feature ?? ''}`
  }

  private parseKey(key: MetricKey): { metric: string; feature?: string } {
    const [metric, feature = ''] = key.split('\0')
    return feature ? { metric, feature } : { metric }
  }

  private addToMap(
    store: Map<MetricKey, Map<string, number>>,
    metric: string,
    value: number,
    options?: MetricsFeatureOptions,
  ): void {
    const variant = options?.variant ?? 'enabled'
    const mapKey = this.key(metric, options?.feature)
    let variants = store.get(mapKey)
    if (!variants) {
      variants = new Map()
      store.set(mapKey, variants)
    }
    variants.set(variant, (variants.get(variant) ?? 0) + value)
  }

  measure(metric: string, value: number, options?: MetricsFeatureOptions): void {
    this.addToMap(this.measures, metric, value, options)
  }

  incrementCounter(metric: string, value = 1, options?: MetricsFeatureOptions): void {
    this.addToMap(this.counters, metric, value, options)
  }

  observe(metric: string, value: number, options?: MetricsFeatureOptions): void {
    this.observations.push({
      time: new Date(),
      metric,
      feature: options?.feature,
      variant: options?.variant ?? 'enabled',
      value,
    })
  }

  isEmpty(): boolean {
    return this.measures.size === 0 && this.counters.size === 0 && this.observations.length === 0
  }

  private drainMap(
    store: Map<MetricKey, Map<string, number>>,
  ): Array<{ metric: string; feature?: string; variantValues: Record<string, number> }> {
    const out: Array<{ metric: string; feature?: string; variantValues: Record<string, number> }> =
      []
    for (const [key, variants] of store) {
      const parsed = this.parseKey(key)
      const variantValues: Record<string, number> = {}
      for (const [variant, value] of variants) {
        if (value !== 0) {
          variantValues[variant] = value
        }
      }
      if (Object.keys(variantValues).length > 0) {
        out.push({
          metric: parsed.metric,
          ...(parsed.feature ? { feature: parsed.feature } : {}),
          variantValues,
        })
      }
    }
    store.clear()
    return out
  }

  buildAndReset(): MetricStatPayload | null {
    if (this.isEmpty()) {
      return null
    }

    const observationGroups = new Map<
      string,
      {
        time: { seconds: number; nanos: number }
        metric: string
        feature?: string
        variantValues: Record<string, number>
      }
    >()

    for (const obs of this.observations) {
      const groupKey = `${obs.time.toISOString()}\0${obs.metric}\0${obs.feature ?? ''}`
      let group = observationGroups.get(groupKey)
      if (!group) {
        group = {
          time: toProtobufTimestamp(obs.time),
          metric: obs.metric,
          ...(obs.feature ? { feature: obs.feature } : {}),
          variantValues: {},
        }
        observationGroups.set(groupKey, group)
      }
      group.variantValues[obs.variant] = obs.value
    }
    this.observations = []

    const payload: MetricStatPayload = {
      appKey: this.appKey,
      environment: this.environment,
      time: toProtobufTimestamp(),
      stats: this.drainMap(this.measures),
      counters: this.drainMap(this.counters),
      observations: [...observationGroups.values()],
    }

    if (this.instanceName) {
      payload.instanceName = this.instanceName
    }

    return payload
  }
}
