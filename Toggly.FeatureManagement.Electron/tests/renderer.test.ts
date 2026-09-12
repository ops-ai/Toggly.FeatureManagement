import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isFeatureOn,
  isFeatureOff,
  evaluateFeatureGate,
  getFlags,
  setContext,
  clearContext,
  onFlagsUpdated,
} from '../src/renderer/index.js'
import type { TogglyBridge } from '../src/types.js'

describe('renderer wrappers', () => {
  const bridge: TogglyBridge = {
    isFeatureOn: vi.fn(() => true),
    isFeatureOff: vi.fn(() => false),
    evaluateFeatureGate: vi.fn(() => true),
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
