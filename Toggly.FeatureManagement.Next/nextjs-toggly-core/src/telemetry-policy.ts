import type { TogglyConfig } from './types'

/** Runtime boundary: portable evaluation never imports the trusted transport. */
export interface ClientTelemetry {
  readonly usageEnabled: boolean
  start(): void
  close(options?: {flush?: boolean}): Promise<void>
  setContext?(config: TogglyConfig): void
  captureCheck?(): (feature: string, enabled: boolean) => void
  flushAll(): Promise<void>
  recordCheck(feature: string, enabled: boolean, identity?: string, variant?: string): void
  recordUsage(feature: string, identity?: string, variant?: string): void
  recordView(feature: string, identity?: string, variant?: string): void
  recordDefinitionCacheHit(): void
  recordDefinitionCacheMiss(): void
  measure(metric: string, value: number, options?: {feature?: string; variant?: string}): void
  incrementCounter(metric: string, value?: number, options?: {feature?: string; variant?: string}): void
  observe(metric: string, value: number, options?: {feature?: string; variant?: string}): void
  setGauge?(metric: string, value: number): void
}

export interface TelemetryPolicy {
  frontend: boolean
  create(config: TogglyConfig): ClientTelemetry | null
}
