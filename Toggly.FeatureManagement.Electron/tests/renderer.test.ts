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
} from '../src/renderer/index.js'
import type { TogglyBridge } from '../src/types.js'

describe('renderer wrappers', () => {
  const bridge: TogglyBridge = {
    recordUsage: vi.fn(),
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
})
