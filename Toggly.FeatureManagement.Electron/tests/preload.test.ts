import { describe, it, expect, vi, beforeEach } from 'vitest'

const exposeInMainWorld = vi.fn()
const sendSync = vi.fn(() => true)
const invoke = vi.fn(async () => ({ A: true }))
const on = vi.fn()
const removeListener = vi.fn()

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: {
    sendSync,
    invoke,
    on,
    removeListener,
  },
}))

describe('exposeToggly', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('freezes and exposes window.toggly API', async () => {
    const { exposeToggly } = await import('../src/preload/index.js')
    exposeToggly()
    expect(exposeInMainWorld).toHaveBeenCalledWith('toggly', expect.any(Object))
    const api = exposeInMainWorld.mock.calls[0][1] as {
      isFeatureOn: (k: string) => boolean
      isFeatureOff: (k: string) => boolean
      evaluateFeatureGate: (keys: string[]) => boolean
      getVariant: (k: string) => { name: string; configurationValue?: unknown } | null
      getVariantValue: (k: string) => unknown
      getFlags: () => Promise<Record<string, boolean>>
      setContext: (c: object) => Promise<Record<string, boolean>>
      clearContext: () => Promise<Record<string, boolean>>
      onFlagsUpdated: (cb: (f: Record<string, boolean>) => void) => () => void
    }
    expect(Object.isFrozen(api)).toBe(true)
    expect(api.isFeatureOn('A')).toBe(true)
    expect(sendSync).toHaveBeenCalled()
    expect(api.isFeatureOff('A')).toBe(true)
    expect(api.evaluateFeatureGate(['A'])).toBe(true)
    sendSync.mockReturnValueOnce({ name: 'treatment', configurationValue: 7 })
    expect(api.getVariant('A')).toEqual({ name: 'treatment', configurationValue: 7 })
    sendSync.mockReturnValueOnce({ name: 'treatment', configurationValue: 7 })
    expect(api.getVariantValue('A')).toBe(7)
    await api.getFlags()
    await api.setContext({ identity: 'x' })
    await api.clearContext()
    expect(invoke).toHaveBeenCalled()
    const unsub = api.onFlagsUpdated(() => undefined)
    expect(on).toHaveBeenCalled()
    unsub()
    expect(removeListener).toHaveBeenCalled()
  })
})
