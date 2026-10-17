import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isFeatureOn,
  isFeatureOff,
  evaluateFeatureGate,
  getFlags,
  getVariant,
  getVariantValue,
  setContext,
  clearContext,
  onFlagsUpdated,
  use,
} from '../src/renderer/index.js'
import type { TogglyBridge } from '../src/types.js'

describe('renderer wrappers', () => {
  const bridge: TogglyBridge = {
    recordUsage: vi.fn(),
    recordUsageScopeCompletion: vi.fn(),
    recordView: vi.fn(),
    incrementCounter: vi.fn(),
    setGauge: vi.fn(),
    flushTelemetry: vi.fn(async () => {}),
    onEvaluationsChanged: vi.fn(() => () => {}),
    isFeatureOn: vi.fn(() => true),
    isFeatureOff: vi.fn(() => false),
    evaluateFeatureGate: vi.fn(() => true),
    getVariant: vi.fn(() => ({ name: 'treatment', configurationValue: 42 })),
    getVariantValue: vi.fn(() => 42),
    getFlags: vi.fn(async () => ({ A: true })),
    setContext: vi.fn(async () => ({ A: true })),
    clearContext: vi.fn(async () => ({})),
    onFlagsUpdated: vi.fn((cb) => {
      cb({ A: true })
      return () => undefined
    }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error test global
    globalThis.window = { toggly: bridge }
  })

  it('delegates to window.toggly', async () => {
    expect(isFeatureOn('A')).toBe(true)
    expect(isFeatureOff('A')).toBe(false)
    expect(evaluateFeatureGate(['A'], 'all')).toBe(true)
    expect(getVariant('A')).toEqual({ name: 'treatment', configurationValue: 42 })
    expect(getVariantValue('A')).toBe(42)
    expect(await getFlags()).toEqual({ A: true })
    expect(await setContext({ identity: 'x' })).toEqual({ A: true })
    expect(await clearContext()).toEqual({})
    const unsub = onFlagsUpdated(() => undefined)
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('returns safe defaults when bridge missing', async () => {
    // @ts-expect-error test global
    globalThis.window = {}
    expect(isFeatureOn('A')).toBe(false)
    expect(isFeatureOff('A')).toBe(true)
    expect(evaluateFeatureGate(['A'])).toBe(false)
    expect(evaluateFeatureGate(['A'], 'all', true)).toBe(true)
    expect(getVariant('A')).toBeNull()
    expect(getVariantValue('A')).toBeNull()
    expect(onFlagsUpdated(() => undefined)).toBeTypeOf('function')
    await expect(getFlags()).rejects.toThrow(/window.toggly/)
  })

  it('rejects setContext/clearContext when bridge missing', async () => {
    // @ts-expect-error test global
    globalThis.window = {}
    await expect(setContext({ identity: 'x' })).rejects.toThrow(/window.toggly/)
    await expect(clearContext()).rejects.toThrow(/window.toggly/)
  })

  it('records usage scope attempt and completion through the bridge', async () => {
    await expect(use('Checkout', async () => 'ok')).resolves.toBe('ok')
    expect(bridge.recordUsage).toHaveBeenCalledWith('Checkout', 'enabled')
    expect(bridge.recordUsageScopeCompletion).toHaveBeenCalledWith(
      'Checkout',
      'enabled',
      false,
      expect.any(Number),
    )

    await expect(
      use('Checkout', async (scope) => {
        scope.fail()
        return 'soft'
      }, 'blue'),
    ).resolves.toBe('soft')
    expect(bridge.recordUsage).toHaveBeenCalledWith('Checkout', 'blue')
    expect(bridge.recordUsageScopeCompletion).toHaveBeenCalledWith(
      'Checkout',
      'blue',
      true,
      expect.any(Number),
    )

    await expect(
      use('Checkout', async () => {
        throw new Error('renderer-boom')
      }),
    ).rejects.toThrow('renderer-boom')
    expect(bridge.recordUsageScopeCompletion).toHaveBeenCalledWith(
      'Checkout',
      'enabled',
      true,
      expect.any(Number),
    )
  })

  it('runs usage scope without a bridge', async () => {
    // @ts-expect-error test global
    globalThis.window = {}
    await expect(use('Checkout', async () => 'ok')).resolves.toBe('ok')
    await expect(
      use('Checkout', async () => {
        throw new Error('no-bridge')
      }),
    ).rejects.toThrow('no-bridge')
  })
})
