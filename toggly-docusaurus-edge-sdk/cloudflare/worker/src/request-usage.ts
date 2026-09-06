import type { TelemetryRuntime } from './telemetry';

/**
 * Request-scoped usage helper: every gate still increments checkCount, but
 * `requestCount` (uniqueRequest) fires at most once per feature+variant
 * within a single HTTP request.
 */
export class RequestScopedUsageRecorder {
  private readonly seenRequestKeys = new Set<string>();

  constructor(private readonly telemetry: TelemetryRuntime | null) {}

  private requestKey(feature: string, enabled: boolean): string {
    return `${feature}\0${enabled ? 'enabled' : 'disabled'}`;
  }

  /**
   * Record a page or section gate evaluation.
   * Returns whether this call counted as a unique request for the variant.
   */
  recordGate(
    feature: string,
    enabled: boolean,
    identity?: string,
  ): boolean {
    if (!this.telemetry?.isUsageEnabled()) {
      return false;
    }

    const key = this.requestKey(feature, enabled);
    const uniqueRequest = !this.seenRequestKeys.has(key);
    if (uniqueRequest) {
      this.seenRequestKeys.add(key);
    }

    this.telemetry.recordCheck(feature, enabled, identity, uniqueRequest);
    if (enabled) {
      this.telemetry.recordView(feature, identity);
    }
    return uniqueRequest;
  }
}
