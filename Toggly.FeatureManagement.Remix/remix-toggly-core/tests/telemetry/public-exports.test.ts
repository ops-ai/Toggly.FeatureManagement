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
    expect(typeof TelemetryRuntime).toBe('function')
    expect(typeof UsageBatcher).toBe('function')
    expect(typeof MetricsBatcher).toBe('function')
    expect(typeof HttpsTelemetryClient).toBe('function')
    expect(typeof hashIdentity('user')).toBe('number')
    expect(resolveTelemetryEnableFlag(undefined, true)).toBe(true)
    expect(DEFAULT_METRICS_BASE_URL).toContain('toggly.io')
  })
})
