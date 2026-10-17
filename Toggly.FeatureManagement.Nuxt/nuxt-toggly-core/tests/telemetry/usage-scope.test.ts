import { afterEach, describe, expect, it, vi } from 'vitest'
import { isUsageCancellation, runFeatureUsageScope } from '../../src/telemetry/usage-scope'

describe('usage-scope', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('detects AbortError and CanceledError names', () => {
    expect(isUsageCancellation(null)).toBe(false)
    expect(isUsageCancellation('AbortError')).toBe(false)
    expect(isUsageCancellation({ name: 'AbortError' })).toBe(true)
    expect(isUsageCancellation({ name: 'CanceledError' })).toBe(true)
    expect(isUsageCancellation({ name: 'Error' })).toBe(false)
  })

  it('records attempt, success duration, soft fail, hard fail, and cancels without failure', async () => {
    vi.useFakeTimers()
    const calls: Array<[string, number?]> = []
    const handlers = {
      recordAttempt: () => calls.push(['attempt']),
      recordSuccessDuration: (ms: number) => calls.push(['success', ms]),
      recordFailure: (ms: number) => calls.push(['failure', ms]),
    }

    await runFeatureUsageScope(handlers, async () => {
      vi.advanceTimersByTime(12)
      return 'ok'
    })

    const abort = new DOMException('Aborted', 'AbortError')
    await expect(
      runFeatureUsageScope(handlers, async () => {
        throw abort
      }),
    ).rejects.toBe(abort)

    await runFeatureUsageScope(handlers, async (scope) => {
      vi.advanceTimersByTime(8)
      scope.fail()
    })

    await expect(
      runFeatureUsageScope(handlers, async () => {
        vi.advanceTimersByTime(5)
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(calls.filter(([kind]) => kind === 'attempt')).toHaveLength(4)
    expect(calls).toContainEqual(['success', 12])
    expect(calls).toContainEqual(['failure', 8])
    expect(calls.some(([kind, ms]) => kind === 'failure' && (ms ?? 0) >= 5)).toBe(true)
    expect(calls.filter(([kind]) => kind === 'failure')).toHaveLength(2)
  })
})
