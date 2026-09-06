import { sdkUserAgent } from '../sdk-identity.js'
import { protobufTimestampToIso } from './hash.js'
import type { FeatureStatPayload } from './usage-batcher.js'
import type { MetricStatPayload } from './metrics-batcher.js'

export const DEFAULT_METRICS_BASE_URL = 'https://app.toggly.io/'
export const DEFAULT_TELEMETRY_FLUSH_MS = 60_000

export interface HttpsTelemetryClientOptions {
  metricsBaseUrl?: string
  userAgent?: string
  fetchImpl?: typeof fetch
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

/** Convert protobuf-timestamp usage payload to gateway HTTPS JSON (PHP parity). */
export function usagePayloadToHttpJson(payload: FeatureStatPayload): Record<string, unknown> {
  return {
    ...payload,
    time: protobufTimestampToIso(payload.time),
    ...(payload.processStartTime
      ? { processStartTime: protobufTimestampToIso(payload.processStartTime) }
      : {}),
  }
}

/** Convert protobuf-timestamp metrics payload to gateway HTTPS JSON (PHP parity). */
export function metricsPayloadToHttpJson(payload: MetricStatPayload): Record<string, unknown> {
  return {
    ...payload,
    time: protobufTimestampToIso(payload.time),
    observations: (payload.observations ?? []).map((obs) => ({
      ...obs,
      time: protobufTimestampToIso(obs.time),
    })),
  }
}

/**
 * Soft-fail HTTPS JSON client for gateway-accepted usage/metrics paths.
 * Network and non-2xx errors never throw to callers.
 */
export class HttpsTelemetryClient {
  private readonly baseUrl: string
  private readonly userAgent: string
  private readonly fetchImpl: typeof fetch

  constructor(options: HttpsTelemetryClientOptions = {}) {
    this.baseUrl = ensureTrailingSlash(options.metricsBaseUrl ?? DEFAULT_METRICS_BASE_URL)
    this.userAgent = options.userAgent ?? sdkUserAgent()
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis)
  }

  getUserAgent(): string {
    return this.userAgent
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  /**
   * POST JSON. Returns true on 2xx, false on soft-fail (network / non-2xx).
   */
  async post(path: string, body: unknown): Promise<boolean> {
    try {
      const url = new URL(path.replace(/^\//, ''), this.baseUrl).toString()
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        },
        body: JSON.stringify(body),
      })
      return response.ok
    } catch {
      return false
    }
  }

  sendUsageStats(payload: FeatureStatPayload): Promise<boolean> {
    return this.post('api/usage/stats', usagePayloadToHttpJson(payload))
  }

  sendMetrics(payload: MetricStatPayload): Promise<boolean> {
    return this.post('api/metrics', metricsPayloadToHttpJson(payload))
  }
}

export function resolveMetricsBaseUrl(raw?: string): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) {
    return DEFAULT_METRICS_BASE_URL
  }
  return ensureTrailingSlash(trimmed)
}

export function isTelemetryEnvDisabled(): boolean {
  try {
    return typeof process !== 'undefined' && process.env?.TOGGLY_DISABLE_TELEMETRY === '1'
  } catch {
    return false
  }
}
