import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../ipc-channels.js'
import type {
  EntityContextInput,
  FeatureFlagsSnapshot,
  FeatureRequirement,
  SetContextInput,
  TogglyBridge,
} from '../types.js'

/**
 * Expose the Flutter-like `window.toggly` API to the renderer via contextBridge.
 * Call from your preload script with contextIsolation enabled.
 */
export function exposeToggly(): void {
  const api: TogglyBridge = {
    recordUsage(key, variant = 'enabled') {
      ipcRenderer.sendSync(IPC_CHANNELS.recordUsage, key, variant)
    },
    recordView(key, variant = 'enabled') {
      ipcRenderer.sendSync(IPC_CHANNELS.recordView, key, variant)
    },
    incrementCounter(key, value = 1) {
      ipcRenderer.sendSync(IPC_CHANNELS.incrementCounter, key, value)
    },
    setGauge(key, value) {
      ipcRenderer.sendSync(IPC_CHANNELS.setGauge, key, value)
    },
    flushTelemetry() {
      return ipcRenderer.invoke(IPC_CHANNELS.flushTelemetry) as Promise<void>
    },
    isFeatureOn(
      key: string,
      entityContext?: EntityContextInput,
      kind?: string,
    ): boolean {
      return ipcRenderer.sendSync(
        IPC_CHANNELS.isFeatureOn,
        key,
        entityContext ?? null,
        kind,
      ) as boolean
    },

    isFeatureOff(
      key: string,
      entityContext?: EntityContextInput,
      kind?: string,
    ): boolean {
      return ipcRenderer.sendSync(
        IPC_CHANNELS.isFeatureOff,
        key,
        entityContext ?? null,
        kind,
      ) as boolean
    },

    evaluateFeatureGate(
      keys: string[],
      requirement?: FeatureRequirement | string,
      negate?: boolean,
      entityContext?: EntityContextInput,
      kind?: string,
    ): boolean {
      return ipcRenderer.sendSync(
        IPC_CHANNELS.evaluateFeatureGate,
        keys,
        requirement ?? 'all',
        negate ?? false,
        entityContext ?? null,
        kind,
      ) as boolean
    },

    getFlags(): Promise<FeatureFlagsSnapshot> {
      return ipcRenderer.invoke(
        IPC_CHANNELS.getFlags,
      ) as Promise<FeatureFlagsSnapshot>
    },

    setContext(context: SetContextInput): Promise<FeatureFlagsSnapshot> {
      return ipcRenderer.invoke(
        IPC_CHANNELS.setContext,
        context,
      ) as Promise<FeatureFlagsSnapshot>
    },

    clearContext(): Promise<FeatureFlagsSnapshot> {
      return ipcRenderer.invoke(
        IPC_CHANNELS.clearContext,
      ) as Promise<FeatureFlagsSnapshot>
    },

    onEvaluationsChanged(callback: () => void): () => void {
      const listener = () => callback()
      ipcRenderer.on(IPC_CHANNELS.evaluationsChanged, listener)
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.evaluationsChanged, listener)
    },
    onFlagsUpdated(
      callback: (flags: FeatureFlagsSnapshot) => void,
    ): () => void {
      const listener = (_event: unknown, flags: FeatureFlagsSnapshot) => {
        callback(flags)
      }
      ipcRenderer.on(IPC_CHANNELS.flagsUpdated, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.flagsUpdated, listener)
      }
    },
  }

  contextBridge.exposeInMainWorld('toggly', Object.freeze(api))
}
