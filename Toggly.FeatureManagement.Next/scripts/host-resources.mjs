/** Attempt every owned cleanup and retain both verification and cleanup failures. */
export async function withResources(run) {
  const cleanups = [], errors = []
  let result
  try { result = await run(cleanup => cleanups.push(cleanup)) } catch (error) { errors.push(error) }
  for (const cleanup of cleanups.reverse()) {
    try { await cleanup() } catch (error) { errors.push(error) }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'Verification and cleanup failed')
  return result
}
export async function bounded(action, label, milliseconds = 5000) {
  let timer
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`${label} timed out`)), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}
export async function closeServer(server) {
  await bounded(() => new Promise((resolve, reject) => {
    server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve())
    server.closeAllConnections()
  }), 'HTTP cleanup')
}
export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  try { await bounded(() => exited, 'Child shutdown', 2000) }
  catch {
    child.kill('SIGKILL')
    await bounded(() => exited, 'Child forced shutdown')
  }
}
export function ownBrowser(defer, browser) {
  // Register process cleanup separately: a rejected/hung protocol close must not leak Chrome.
  defer(() => stopChild(browser.process()))
  defer(() => bounded(() => browser.close(), 'Browser cleanup'))
}
