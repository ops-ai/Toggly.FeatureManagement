import { describe, it, expect } from 'vitest'
import {
  TelemetryRuntime,
  UsageBatcher,
  MetricsBatcher,
  HttpsTelemetryClient,
  hashIdentity,
  resolveTelemetryEnableFlag,
  DEFAULT_METRICS_BASE_URL,
} from '../../src/telemetry/public'

describe('telemetry public surface', () => {
  it('re-exports runtime helpers for edge-safe consumers', () => {
    expect(TelemetryRuntime).toBeTypeOf('function')
    expect(UsageBatcher).toBeTypeOf('function')
    expect(MetricsBatcher).toBeTypeOf('function')
    expect(HttpsTelemetryClient).toBeTypeOf('function')
    expect(hashIdentity('user')).toBeTypeOf('number')
    expect(resolveTelemetryEnableFlag(undefined, true)).toBe(true)
    expect(DEFAULT_METRICS_BASE_URL).toContain('toggly.io')
  })
})
