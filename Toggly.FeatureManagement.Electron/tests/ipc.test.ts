import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../src/ipc-channels.js'
import {
  initToggly,
  closeToggly,
  __resetTogglyForTests,
} from '../src/main/client.js'
import { registerTogglyIpc } from '../src/main/ipc.js'

describe('registerTogglyIpc', () => {
  let userDataPath: string
  const handlers = new Map<string, Function>()
  const syncHandlers = new Map<string, Function>()

  const ipcMain = {
    on: vi.fn((channel: string, listener: Function) => {
      syncHandlers.set(channel, listener)
    }),
    handle: vi.fn((channel: string, listener: Function) => {
      handlers.set(channel, listener)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
    removeAllListeners: vi.fn((channel: string) => {
      syncHandlers.delete(channel)
    }),
  }

  beforeEach(async () => {
    handlers.clear()
    syncHandlers.clear()
    __resetTogglyForTests()
    userDataPath = await mkdtemp(join(tmpdir(), 'toggly-ipc-'))
    await initToggly({
      userDataPath,
      enableLiveUpdates: false,
      flagDefaults: { Feature: true, Off: false },
    })
  })

  afterEach(async () => {
    closeToggly()
    __resetTogglyForTests()
    await rm(userDataPath, { recursive: true, force: true })
  })

  it('throws when toggly is not initialized', () => {
    closeToggly()
    expect(() => registerTogglyIpc(ipcMain)).toThrow(/not initialized/)
  })

  it('registers sync and async handlers', async () => {
    const sent: Array<{ channel: string; args: unknown[] }> = []
    const windows = [
      {
        webContents: {
          send: (channel: string, ...args: unknown[]) => {
            sent.push({ channel, args })
          },
          isDestroyed: () => false,
        },
        isDestroyed: () => false,
      },
    ]

    const unregister = registerTogglyIpc(ipcMain, () => windows)

    const event = { returnValue: undefined as unknown }
    syncHandlers.get(IPC_CHANNELS.isFeatureOn)?.(event, 'Feature')
    expect(event.returnValue).toBe(true)

    syncHandlers.get(IPC_CHANNELS.isFeatureOff)?.(event, 'Feature')
    expect(event.returnValue).toBe(false)

    syncHandlers
      .get(IPC_CHANNELS.evaluateFeatureGate)
      ?. (event, ['Feature', 'Off'], 'any', false)
    expect(event.returnValue).toBe(true)

    const flags = await handlers.get(IPC_CHANNELS.getFlags)?.({})
    expect(flags).toMatchObject({ Feature: true })

    const afterSet = await handlers.get(IPC_CHANNELS.setContext)?.({}, {
      identity: 'bob',
    })
    expect(afterSet).toBeTruthy()

    const afterClear = await handlers.get(IPC_CHANNELS.clearContext)?.({})
    expect(afterClear).toBeTruthy()

    const { getToggly } = await import('../src/main/client.js')
    await getToggly()!.refresh()
    expect(sent.some((s) => s.channel === IPC_CHANNELS.flagsUpdated)).toBe(true)

    unregister()
    expect(ipcMain.removeHandler).toHaveBeenCalled()
  })

  it('skips destroyed windows when broadcasting', async () => {
    const send = vi.fn()
    registerTogglyIpc(ipcMain, () => [
      {
        isDestroyed: () => true,
        webContents: { send, isDestroyed: () => false },
      },
      {
        isDestroyed: () => false,
        webContents: { send, isDestroyed: () => true },
      },
    ])
    const { getToggly } = await import('../src/main/client.js')
    await getToggly()!.refresh()
    expect(send).not.toHaveBeenCalled()
  })
})
