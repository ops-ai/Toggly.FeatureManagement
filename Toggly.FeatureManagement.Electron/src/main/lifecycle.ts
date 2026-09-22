import { getToggly } from './client.js'

/** Structural Electron app/powerMonitor surface; no import-time Electron access. */
export interface LifecycleEvents {
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
}

/** Attach once per main owner. Background flushes never dispose another window's owner. */
export function attachTogglyLifecycle(
  app: LifecycleEvents & { quit(): void },
  powerMonitor?: LifecycleEvents,
): () => void {
  const client = getToggly()
  if (!client)
    throw new Error('Toggly is not initialized. Call initToggly first.')
  let quitting = false
  const flush = () => {
    void client.flushTelemetry()
  }
  const close = () => client.close()
  const beforeQuit = (event: { preventDefault(): void }) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    // Dispose first: one plain final envelope, no retry or new accepted data.
    client.close()
    let timer: ReturnType<typeof setTimeout>
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 5000)
    })
    void Promise.race([client.flushTelemetry(), deadline]).finally(() => {
      clearTimeout(timer)
      app.quit()
    })
  }
  app.on('browser-window-blur', flush)
  app.on('window-all-closed', flush)
  app.on('before-quit', beforeQuit)
  app.on('will-quit', close)
  powerMonitor?.on('suspend', flush)
  const detach = () => {
    app.removeListener('browser-window-blur', flush)
    app.removeListener('window-all-closed', flush)
    app.removeListener('before-quit', beforeQuit)
    app.removeListener('will-quit', close)
    powerMonitor?.removeListener('suspend', flush)
    unsubscribe()
  }
  const unsubscribe = client.onClose(detach)
  return detach
}
