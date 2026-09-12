import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../ipc-channels.js'
import {
  clearContext,
  evaluateFeatureGate,
  getToggly,
  isFeatureOff,
  isFeatureOn,
  setContext,
  type ElectronTogglyClient,
} from './client.js'
import type { EntityContextInput, FeatureRequirement, SetContextInput } from '../types.js'

export type IpcMainLike = {
  on: (
    channel: string,
    listener: (event: { returnValue: unknown }, ...args: unknown[]) => void,
  ) => void
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>,
  ) => void
  removeHandler?: (channel: string) => void
  removeAllListeners?: (channel: string) => void
}

export type WebContentsLike = {
  send: (channel: string, ...args: unknown[]) => void
  isDestroyed?: () => boolean
}

export type BrowserWindowLike = {
  webContents: WebContentsLike
  isDestroyed?: () => boolean
}

/**
 * Register main-process handlers and fan out flag updates to renderer windows.
 * Call after `initToggly`.
 */
export function registerTogglyIpc(
  ipcMain: IpcMainLike,
  getWindows: () => Array<BrowserWindow | BrowserWindowLike> = () => [],
): () => void {
  const client = getToggly()
  if (!client) {
    throw new Error('Toggly is not initialized. Call initToggly before registerTogglyIpc.')
  }

  ipcMain.on(IPC_CHANNELS.isFeatureOn, (event, key, entityContext, kind) => {
    event.returnValue = isFeatureOn(
      String(key),
      entityContext as EntityContextInput,
      kind as string | undefined,
    )
  })

  ipcMain.on(IPC_CHANNELS.isFeatureOff, (event, key, entityContext, kind) => {
    event.returnValue = isFeatureOff(
      String(key),
      entityContext as EntityContextInput,
      kind as string | undefined,
    )
  })

  ipcMain.on(
    IPC_CHANNELS.evaluateFeatureGate,
    (event, keys, requirement, negate, entityContext, kind) => {
      event.returnValue = evaluateFeatureGate(
        (keys as string[]) ?? [],
        requirement as FeatureRequirement | string | undefined,
        Boolean(negate),
        entityContext as EntityContextInput,
        kind as string | undefined,
      )
    },
  )

  ipcMain.handle(IPC_CHANNELS.getFlags, () => {
    return getToggly()?.getFlags() ?? {}
  })

  ipcMain.handle(IPC_CHANNELS.setContext, (_event, context) => {
    return setContext((context as SetContextInput) ?? {})
  })

  ipcMain.handle(IPC_CHANNELS.clearContext, () => {
    return clearContext()
  })

  const unsubscribe = client.onFlagsUpdated((flags) => {
    for (const win of getWindows()) {
      try {
        if (win.isDestroyed?.()) {
          continue
        }
        if (win.webContents.isDestroyed?.()) {
          continue
        }
        win.webContents.send(IPC_CHANNELS.flagsUpdated, flags)
      } catch {
        // window may have closed
      }
    }
  })

  return () => {
    unsubscribe()
    ipcMain.removeAllListeners?.(IPC_CHANNELS.isFeatureOn)
    ipcMain.removeAllListeners?.(IPC_CHANNELS.isFeatureOff)
    ipcMain.removeAllListeners?.(IPC_CHANNELS.evaluateFeatureGate)
    ipcMain.removeHandler?.(IPC_CHANNELS.getFlags)
    ipcMain.removeHandler?.(IPC_CHANNELS.setContext)
    ipcMain.removeHandler?.(IPC_CHANNELS.clearContext)
  }
}

export type { ElectronTogglyClient }
