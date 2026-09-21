import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../ipc-channels.js'
import { getToggly, type ElectronTogglyClient } from './client.js'
import type {
  EntityContextInput,
  FeatureRequirement,
  SetContextInput,
} from '../types.js'

export type IpcMainLike = {
  on: (
    channel: string,
    listener: (event: { returnValue: unknown }, ...args: unknown[]) => void,
  ) => void
  handle: (
    channel: string,
    listener: (
      event: unknown,
      ...args: unknown[]
    ) => unknown | Promise<unknown>,
  ) => void
  removeHandler?: (channel: string) => void
  removeAllListeners?: (channel: string) => void
}

export type WebContentsLike = {
  send: (channel: string, ...args: unknown[]) => void
  isDestroyed?: () => boolean
  mainFrame?: unknown
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
    throw new Error(
      'Toggly is not initialized. Call initToggly before registerTogglyIpc.',
    )
  }

  // Existing evaluation/context authorization is retained. New telemetry calls
  // require an explicitly supplied live window and its exact top-level frame.
  const trusted = (event: unknown): boolean => {
    if (!event || typeof event !== 'object') return false
    const { sender, senderFrame } = event as {
      sender?: unknown
      senderFrame?: unknown
    }
    return getWindows().some(
      (win) =>
        !win.isDestroyed?.() &&
        !win.webContents.isDestroyed?.() &&
        sender === win.webContents &&
        Boolean(senderFrame) &&
        senderFrame === win.webContents.mainFrame,
    )
  }
  const syncChannels: string[] = []
  const asyncChannels: string[] = []
  const sync = (
    channel: string,
    handler: (args: unknown[]) => unknown,
    validate: (args: unknown[]) => boolean,
    secured = false,
  ) => {
    syncChannels.push(channel)
    ipcMain.on(channel, (event, ...args) => {
      event.returnValue =
        (!secured || trusted(event)) && validate(args) ? handler(args) : false
    })
  }
  const async = (
    channel: string,
    handler: (args: unknown[]) => unknown,
    validate: (args: unknown[]) => boolean,
    secured = false,
  ) => {
    asyncChannels.push(channel)
    ipcMain.handle(channel, (event, ...args) => {
      if ((secured && !trusted(event)) || !validate(args))
        throw new Error('Invalid Toggly IPC request')
      return handler(args)
    })
  }
  const featureArgs = (args: unknown[]) =>
    args.length <= 3 &&
    validKey(args[0]) &&
    validContext(args[1]) &&
    (args[2] === undefined || validKey(args[2]))
  sync(
    IPC_CHANNELS.isFeatureOn,
    ([key, context, kind]) =>
      client.isFeatureOn(
        key as string,
        context as EntityContextInput,
        kind as string | undefined,
      ),
    featureArgs,
  )
  sync(
    IPC_CHANNELS.isFeatureOff,
    ([key, context, kind]) =>
      client.isFeatureOff(
        key as string,
        context as EntityContextInput,
        kind as string | undefined,
      ),
    featureArgs,
  )
  sync(
    IPC_CHANNELS.evaluateFeatureGate,
    ([keys, requirement, negate, context, kind]) =>
      client.evaluateFeatureGate(
        keys as string[],
        requirement as FeatureRequirement,
        negate as boolean,
        context as EntityContextInput,
        kind as string | undefined,
      ),
    (args) =>
      args.length <= 5 &&
      Array.isArray(args[0]) &&
      args[0].length <= 2000 &&
      args[0].every(validKey) &&
      (args[1] === undefined || typeof args[1] === 'string') &&
      (args[2] === undefined || typeof args[2] === 'boolean') &&
      validContext(args[3]) &&
      (args[4] === undefined || validKey(args[4])),
  )
  async(
    IPC_CHANNELS.getFlags,
    () => client.getFlags(),
    (args) => args.length === 0,
  )
  async(
    IPC_CHANNELS.setContext,
    ([context]) => client.setContext((context as SetContextInput) ?? {}),
    (args) => args.length <= 1 && validSetContext(args[0]),
  )
  async(
    IPC_CHANNELS.clearContext,
    () => client.clearContext(),
    (args) => args.length === 0,
  )
  const eventArgs = (args: unknown[]) =>
    args.length <= 2 &&
    validKey(args[0]) &&
    (args[1] === undefined ||
      (typeof args[1] === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(args[1])))
  sync(
    IPC_CHANNELS.recordUsage,
    ([key, variant]) =>
      client.recordUsage(key as string, variant as string | undefined),
    eventArgs,
    true,
  )
  sync(
    IPC_CHANNELS.recordView,
    ([key, variant]) =>
      client.recordView(key as string, variant as string | undefined),
    eventArgs,
    true,
  )
  const metricArgs = (args: unknown[], counter: boolean) =>
    args.length <= 2 &&
    validKey(args[0]) &&
    ((counter && args[1] === undefined) ||
      (typeof args[1] === 'number' &&
        Number.isFinite(args[1]) &&
        args[1] >= 0 &&
        args[1] <= 1000000 &&
        (!counter || Number.isInteger(args[1]))))
  sync(
    IPC_CHANNELS.incrementCounter,
    ([key, value]) =>
      client.incrementCounter(key as string, value as number | undefined),
    (args) => metricArgs(args, true),
    true,
  )
  sync(
    IPC_CHANNELS.setGauge,
    ([key, value]) => client.setGauge(key as string, value as number),
    (args) => metricArgs(args, false),
    true,
  )
  async(
    IPC_CHANNELS.flushTelemetry,
    () => client.flushTelemetry(),
    (args) => args.length === 0,
    true,
  )

  const broadcast = (channel: string, ...args: unknown[]) => {
    for (const win of getWindows()) {
      try {
        if (win.isDestroyed?.()) {
          continue
        }
        if (win.webContents.isDestroyed?.()) {
          continue
        }
        win.webContents.send(channel, ...args)
      } catch {
        // window may have closed
      }
    }
  }
  const unsubscribe = client.onFlagsUpdated((flags) =>
    broadcast(IPC_CHANNELS.flagsUpdated, flags),
  )
  const unsubscribeEvaluations = client.onEvaluationsChanged(() =>
    broadcast(IPC_CHANNELS.evaluationsChanged),
  )

  let active = true
  const unregister = () => {
    if (!active) return
    active = false
    detachClose()
    unsubscribe()
    unsubscribeEvaluations()
    for (const channel of syncChannels) ipcMain.removeAllListeners?.(channel)
    for (const channel of asyncChannels) ipcMain.removeHandler?.(channel)
  }
  const detachClose = client.onClose(unregister)
  // Existing windows must evaluate the newly registered owner, never retain
  // another application's cached React result after main reinitialization.
  broadcast(IPC_CHANNELS.evaluationsChanged)
  return unregister
}

export type { ElectronTogglyClient }

function validKey(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= 1024
  )
}
function validContext(value: unknown): boolean {
  if (value == null) return true
  if (typeof value !== 'object' || Array.isArray(value)) return false
  let bytes = 0,
    entries = 0
  const pending: Array<[unknown, number]> = [[value, 0]]
  while (pending.length) {
    const [item, depth] = pending.pop()!
    if (++entries > 2000 || depth > 8) return false
    if (typeof item === 'string') bytes += item.length * 3
    else if (item && typeof item === 'object') {
      const keys = Object.keys(item)
      if (keys.length + entries + pending.length > 2000) return false
      for (const key of keys) {
        bytes += key.length * 3
        pending.push([(item as Record<string, unknown>)[key], depth + 1])
      }
    } else if (
      item !== null &&
      item !== undefined &&
      typeof item !== 'boolean' &&
      (typeof item !== 'number' || !Number.isFinite(item))
    )
      return false
    if (bytes > 16384) return false
  }
  return true
}
function validSetContext(value: unknown): boolean {
  if (value == null) return true
  if (!validContext(value)) return false
  const context = value as SetContextInput
  return (
    Object.keys(context).every((key) =>
      ['identity', 'groups', 'claims'].includes(key),
    ) &&
    (context.identity === undefined || typeof context.identity === 'string') &&
    (context.groups === undefined ||
      (Array.isArray(context.groups) &&
        context.groups.every((group) => typeof group === 'string'))) &&
    (context.claims === undefined ||
      (context.claims !== null &&
        typeof context.claims === 'object' &&
        !Array.isArray(context.claims) &&
        Object.values(context.claims).every(
          (claim) => typeof claim === 'string',
        )))
  )
}
