import { WORKER_USER_AGENT } from './version';

export const DEFAULT_METRICS_BASE_URL = 'https://app.toggly.io/';

export interface HttpsTelemetryClientOptions {
  metricsBaseUrl?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

/**
 * Soft-fail HTTPS JSON client for gateway-accepted usage/metrics paths.
 * Network and non-2xx errors never throw to callers.
 */
export class HttpsTelemetryClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpsTelemetryClientOptions = {}) {
    this.baseUrl = ensureTrailingSlash(options.metricsBaseUrl ?? DEFAULT_METRICS_BASE_URL);
    this.userAgent = options.userAgent ?? WORKER_USER_AGENT;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  getUserAgent(): string {
    return this.userAgent;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * POST JSON. Returns true on 2xx, false on soft-fail (network / non-2xx).
   */
  async post(path: string, body: unknown): Promise<boolean> {
    try {
      const url = new URL(path.replace(/^\//, ''), this.baseUrl).toString();
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        },
        body: JSON.stringify(body),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  sendUsageStats(payload: unknown): Promise<boolean> {
    return this.post('api/usage/stats', payload);
  }

  sendMetrics(payload: unknown): Promise<boolean> {
    return this.post('api/metrics', payload);
  }
}
