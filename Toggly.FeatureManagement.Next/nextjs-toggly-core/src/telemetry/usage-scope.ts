export interface FeatureUsageScope {
  /** Mark the scope as failed; duration is recorded as error metrics on completion. */
  fail(): void
}

/** True for AbortError and common cancellation error names (Node / fetch). */
export function isUsageCancellation(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  return name === 'AbortError' || name === 'CanceledError'
}

function elapsedMs(start: number): number {
  return Math.max(0, Math.round(performance.now() - start))
}

export async function runFeatureUsageScope<T>(
  handlers: {
    recordAttempt: () => void
    recordSuccessDuration: (durationMs: number) => void
    recordFailure: (durationMs: number) => void
  },
  fn: (scope: FeatureUsageScope) => Promise<T>,
): Promise<T> {
  handlers.recordAttempt()
  // Monotonic clock — wall Date.now() skews under NTP / manual time changes.
  const start = performance.now()
  let failed = false
  const scope: FeatureUsageScope = {
    fail() {
      failed = true
    },
  }
  try {
    const result = await fn(scope)
    const durationMs = elapsedMs(start)
    if (failed) {
      handlers.recordFailure(durationMs)
    } else {
      handlers.recordSuccessDuration(durationMs)
    }
    return result
  } catch (error) {
    if (isUsageCancellation(error)) {
      throw error
    }
    handlers.recordFailure(elapsedMs(start))
    throw error
  }
}
