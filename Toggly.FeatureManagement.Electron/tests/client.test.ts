import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ElectronTogglyClient,
  initToggly,
  getToggly,
  isFeatureOn,
  isFeatureOff,
  evaluateFeatureGate,
  setContext,
  clearContext,
  addHook,
  closeToggly,
  __resetTogglyForTests,
} from '../src/main/client.js'

const wsInstances: Array<{
  on: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  removeAllListeners: ReturnType<typeof vi.fn>
  handlers: Record<string, (...args: unknown[]) => void>
}> = []

vi.mock('ws', () => {
  class MockWebSocket {
    handlers: Record<string, (...args: unknown[]) => void> = {}
    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      this.handlers[event] = handler
    })
    close = vi.fn()
    removeAllListeners = vi.fn()
    constructor(_url: string) {
      wsInstances.push(this)
    }
  }
  return { default: MockWebSocket }
})

function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null,
    },
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as Response
}

describe('ElectronTogglyClient', () => {
  let userDataPath: string

  beforeEach(async () => {
    wsInstances.length = 0
    __resetTogglyForTests()
    userDataPath = await mkdtemp(join(tmpdir(), 'toggly-electron-'))
  })

  afterEach(async () => {
    closeToggly()
    __resetTogglyForTests()
    await rm(userDataPath, { recursive: true, force: true })
  })

  it('requires userDataPath', () => {
    expect(
      () =>
        new ElectronTogglyClient({
          userDataPath: '',
        } as never),
    ).toThrow(/userDataPath/)
  })

  it('keeps defaults when optional config keys are undefined', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, { defs: { A: true } }),
    )
    await initToggly({
      appKey: 'app-defaults',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      baseURI: undefined,
      environment: undefined,
      connectTimeout: undefined,
    } as never)
    const url = String(fetchImpl.mock.calls[0][0])
    expect(url).toContain('https://definitions.toggly.io/evaluated-signed/')
    expect(url).toContain('/Production')
  })

  it('init with defaults and no appKey uses flagDefaults', async () => {
    const flags = await initToggly({
      userDataPath,
      flagDefaults: { A: true, B: false },
      enableLiveUpdates: false,
    })
    expect(flags).toEqual({ A: true, B: false })
    expect(isFeatureOn('A')).toBe(true)
    expect(isFeatureOff('B')).toBe(true)
    expect(getToggly()).not.toBeNull()
  })

  it('fetches evaluated-signed and caches flags', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(
        200,
        { defs: { FeatureA: true, FeatureB: false } },
        { 'X-Definitions-Revision': 'rev-1' },
      ),
    )

    const flags = await initToggly({
      appKey: 'app-1',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
    })

    expect(flags.FeatureA).toBe(true)
    expect(fetchImpl).toHaveBeenCalled()
    const url = String(fetchImpl.mock.calls[0][0])
    expect(url).toContain('/evaluated-signed/app-1/Production')
  })

  it('falls back to disk cache when network fails', async () => {
    const fetchOk = vi.fn().mockResolvedValue(
      mockResponse(200, { defs: { Cached: true } }, { ETag: '"etag-1"' }),
    )
    await initToggly({
      appKey: 'app-cache',
      userDataPath,
      fetch: fetchOk,
      enableLiveUpdates: false,
      identity: 'user-1',
    })
    closeToggly()

    const fetchFail = vi.fn().mockRejectedValue(new Error('network down'))
    const flags = await initToggly({
      appKey: 'app-cache',
      userDataPath,
      fetch: fetchFail,
      enableLiveUpdates: false,
      identity: 'user-1',
      flagDefaults: { Cached: false },
    })
    expect(flags.Cached).toBe(true)
  })

  it('falls back to flagDefaults when network fails and cache empty', async () => {
    const fetchFail = vi.fn().mockRejectedValue(new Error('offline'))
    const flags = await initToggly({
      appKey: 'app-offline',
      userDataPath,
      fetch: fetchFail,
      enableLiveUpdates: false,
      flagDefaults: { Offline: true },
    })
    expect(flags.Offline).toBe(true)
  })

  it('handles 304 not modified', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(200, { defs: { X: true } }, { 'X-Definitions-Revision': 'r1' }),
      )
      .mockResolvedValueOnce(
        mockResponse(304, '', { 'X-Definitions-Revision': 'r1' }),
      )

    await initToggly({
      appKey: 'app-304',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
    })
    const client = getToggly()!
    const flags = await client.refresh()
    expect(flags.X).toBe(true)
  })

  it('setContext and clearContext refresh flags', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, { defs: { Flag: true } }),
    )
    await initToggly({
      appKey: 'app-ctx',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
    })
    const afterSet = await setContext({
      identity: 'alice',
      groups: ['beta'],
      claims: { plan: 'pro' },
    })
    expect(afterSet.Flag).toBe(true)
    const afterClear = await clearContext()
    expect(afterClear.Flag).toBe(true)
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('addHook runs after refresh', async () => {
    const afterRefresh = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, { defs: { H: true } }),
    )
    await initToggly({
      appKey: 'app-hooks',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      hooks: [
        {
          getMetadata: () => ({ name: 'test' }),
          afterRefresh,
        },
      ],
    })
    addHook({
      getMetadata: () => ({ name: 'late' }),
      beforeEvaluation: () => ({ flagKey: 'H' }),
      afterEvaluation: vi.fn(),
    })
    expect(isFeatureOn('H')).toBe(true)
    expect(afterRefresh).toHaveBeenCalled()
  })

  it('starts websocket when live updates enabled', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, { defs: { W: true } }),
    )
    await initToggly({
      appKey: 'app-ws',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: true,
    })
    expect(wsInstances.length).toBeGreaterThanOrEqual(1)
    const ws = wsInstances[0]
    ws.handlers.open?.()
    ws.handlers.message?.(JSON.stringify({ type: 'ping' }))
    ws.handlers.message?.(
      JSON.stringify({ type: 'sync', etag: 'new-rev', unchanged: false }),
    )
    ws.handlers.message?.(
      JSON.stringify({ type: 'flags-updated', etag: 'newer' }),
    )
    ws.handlers.message?.(
      JSON.stringify({ type: 'signing-key-updated' }),
    )
    ws.handlers.error?.(new Error('ws err'))
    ws.handlers.close?.()
  })

  it('evaluateFeatureGate respects all/any/negate', async () => {
    await initToggly({
      userDataPath,
      enableLiveUpdates: false,
      flagDefaults: { A: true, B: false, C: true },
    })
    // With only defaults and no appKey, features are set from defaults
    expect(evaluateFeatureGate(['A', 'C'], 'all')).toBe(true)
    expect(evaluateFeatureGate(['A', 'B'], 'all')).toBe(false)
    expect(evaluateFeatureGate(['A', 'B'], 'any')).toBe(true)
    expect(evaluateFeatureGate(['B'], 'all', true)).toBe(true)
    expect(evaluateFeatureGate([])).toBe(true)
  })

  it('throws setContext when not initialized', async () => {
    await expect(setContext({ identity: 'x' })).rejects.toThrow(/not initialized/)
    await expect(clearContext()).rejects.toThrow(/not initialized/)
  })

  it('singleton helpers return safe defaults when closed', () => {
    expect(isFeatureOn('x')).toBe(false)
    expect(isFeatureOff('x')).toBe(true)
    expect(evaluateFeatureGate(['x'])).toBe(false)
    expect(evaluateFeatureGate(['x'], 'all', true)).toBe(true)
  })

  it('onError and isDebug report refresh failures', async () => {
    const onError = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchFail = vi.fn().mockRejectedValue(new Error('boom'))
    await initToggly({
      appKey: 'app-err',
      userDataPath,
      fetch: fetchFail,
      enableLiveUpdates: false,
      onError,
      isDebug: true,
      flagDefaults: {},
    })
    expect(onError).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('applies local gates', async () => {
    await initToggly({
      userDataPath,
      enableLiveUpdates: false,
      flagDefaults: { Gated: true },
    })
    const client = getToggly()!
    client.setLocalGates([
      {
        id: 'device',
        flagKeys: ['Gated'],
        isEnabled: () => false,
      },
    ])
    expect(client.isFeatureOn('Gated')).toBe(false)
  })

  it('resolves entity gates fail-closed without context', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, {
        defs: {
          EntityFlag: {
            requirement: 'all',
            rules: [{ property: 'Color', op: 'eq', value: 'red' }],
          },
        },
      }),
    )
    await initToggly({
      appKey: 'app-entity',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
    })
    expect(isFeatureOn('EntityFlag')).toBe(false)
    expect(
      isFeatureOn('EntityFlag', {
        kind: 'Order',
        key: '1',
        attributes: { Color: 'red' },
      }),
    ).toBe(true)
  })

  it('handles non-ok HTTP and listener errors', async () => {
    const onError = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(500, 'fail'))
    await initToggly({
      appKey: 'app-500',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      onError,
      flagDefaults: { Fallback: true },
    })
    expect(isFeatureOn('Fallback')).toBe(true)
    expect(onError).toHaveBeenCalled()

    const client = getToggly()!
    client.onFlagsUpdated(() => {
      throw new Error('listener boom')
    })
    await client.refresh()
    expect(onError).toHaveBeenCalledWith(
      'Flags updated listener error',
      expect.any(Error),
    )
  })

  it('refresh after close returns current snapshot', async () => {
    await initToggly({
      userDataPath,
      enableLiveUpdates: false,
      flagDefaults: { Z: true },
    })
    const client = getToggly()!
    client.close()
    expect(await client.refresh()).toEqual({ Z: true })
  })

  it('re-init closes previous singleton', async () => {
    await initToggly({
      userDataPath,
      enableLiveUpdates: false,
      flagDefaults: { First: true },
    })
    await initToggly({
      userDataPath,
      enableLiveUpdates: false,
      flagDefaults: { Second: true },
    })
    expect(isFeatureOn('Second')).toBe(true)
    expect(isFeatureOn('First')).toBe(false)
  })

  it('sync message with unchanged skips refresh', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, { defs: { W: true } }, { 'X-Definitions-Revision': 'r0' }),
    )
    await initToggly({
      appKey: 'app-ws-sync',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: true,
    })
    const ws = wsInstances[0]
    ws.handlers.open?.()
    const callsBefore = fetchImpl.mock.calls.length
    ws.handlers.message?.(
      JSON.stringify({ type: 'sync', unchanged: true, etag: 'r0' }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchImpl.mock.calls.length).toBe(callsBefore)
  })

  it('uses User-Agent style headers in main process', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, { defs: { H: true } }),
    )
    await initToggly({
      appKey: 'app-headers',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
    })
    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['User-Agent'] || headers['X-Toggly-Sdk']).toBeTruthy()
  })
})
