import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import type { Server } from 'node:http'

export async function bounded<T>(work: () => T | PromiseLike<T>, label: string, milliseconds = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}

// Every independent resource receives cleanup, even when an earlier operation fails.
// Keep the original failure as the cause and first error, without relying on logging.
export async function cleanupOwned(actions: Array<() => unknown>, failure?: unknown): Promise<void> {
  const errors: unknown[] = failure === undefined ? [] : [failure]
  for (const action of actions) {
    try { await bounded(action, 'Owned resource cleanup', 15000) } catch (error) { errors.push(error) }
  }
  if (errors.length) throw new AggregateError(errors, 'Packed host failed; all owned cleanups attempted', { cause: errors[0] })
}

export async function stopChild(child?: ChildProcess): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  child.kill('SIGKILL')
  await bounded(() => exited, 'Owned process exit')
}

export async function closeBrowser(browser: { close(): Promise<void>; process(): ChildProcess | null }, timeout = 5000): Promise<void> {
  const child = browser.process()
  let failure: unknown
  try { await bounded(() => browser.close(), 'Browser close', timeout) } catch (error) { failure = error }
  await cleanupOwned([() => stopChild(child)], failure)
}

export async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  server.closeAllConnections()
  await bounded(() => closed, 'HTTP server close')
}

// Dedicated process groups let the parent reap descendants even if the harness
// itself hangs or fails before it can run its local cleanup.
export async function runOwnedCommand(command: string, args: string[], options: SpawnOptions, timeout = 180000): Promise<string> {
  const child = spawn(command, args, { ...options, detached: process.platform !== 'win32' })
  let output = '', errors = ''
  child.stdout?.on('data', chunk => { output += chunk })
  child.stderr?.on('data', chunk => { errors += chunk })
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`Command failed (${code ?? signal}): ${command}\n${output}${errors}`)))
  })
  let failure: unknown
  try { await bounded(() => exited, 'Packed host command', timeout) } catch (error) { failure = error }
  await cleanupOwned([async () => {
    if (child.pid && process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    } else await stopChild(child)
    await bounded(() => exited.catch(() => {}), 'Command reap')
  }], failure)
  return output
}
