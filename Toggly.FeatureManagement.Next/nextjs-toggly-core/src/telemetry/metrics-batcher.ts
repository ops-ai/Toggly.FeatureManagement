import { toProtobufTimestamp } from './hash.js'

/** Max distinct metric keys (metric+feature) retained per measures/counters map. */
export const MAX_METRIC_KEYS_PER_BATCH = 500
/** Max observation rows retained before flush. */
export const MAX_OBSERVATIONS_PER_BATCH = 1_000

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
  maxMetricKeys?: number
  maxObservations?: number
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
  private readonly maxMetricKeys: number
  private readonly maxObservations: number
  private measures = new Map<MetricKey, Map<string, number>>()
  private counters = new Map<MetricKey, Map<string, number>>()
  private observations: Array<{
    time: Date
    metric: string
    feature?: string
    variant: string
    value: number
  }> = []
  private droppedKeys = false

  constructor(options: MetricsBatcherOptions) {
    this.appKey = options.appKey
    this.environment = options.environment
    this.instanceName = options.instanceName
    this.maxMetricKeys = options.maxMetricKeys ?? MAX_METRIC_KEYS_PER_BATCH
    this.maxObservations = options.maxObservations ?? MAX_OBSERVATIONS_PER_BATCH
  }

  private key(metric: string, feature?: string): MetricKey {
    return `${metric}\0${feature ?? ''}`
  }

  private parseKey(key: MetricKey): { metric: string; feature?: string } {
    const sep = key.indexOf('\0')
    if (sep < 0) {
      return { metric: key }
    }
    const metric = key.slice(0, sep)
    const feature = key.slice(sep + 1)
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
      if (store.size >= this.maxMetricKeys) {
        this.droppedKeys = true
        return
      }
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
    if (this.observations.length >= this.maxObservations) {
      this.droppedKeys = true
      return
    }
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

  hitCap(): boolean {
    return this.droppedKeys
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
    this.droppedKeys = false

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

  restoreFromPayload(payload: MetricStatPayload): void {
    for (const stat of payload.stats ?? []) {
      for (const [variant, value] of Object.entries(stat.variantValues ?? {})) {
        this.measure(stat.metric, value, { feature: stat.feature, variant })
      }
    }
    for (const counter of payload.counters ?? []) {
      for (const [variant, value] of Object.entries(counter.variantValues ?? {})) {
        this.incrementCounter(counter.metric, value, {
          feature: counter.feature,
          variant,
        })
      }
    }
    for (const obs of payload.observations ?? []) {
      for (const [variant, value] of Object.entries(obs.variantValues ?? {})) {
        this.observe(obs.metric, value, { feature: obs.feature, variant })
      }
    }
  }
}
