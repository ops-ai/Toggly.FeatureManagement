import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync } from 'node:fs'
const exec = promisify(execFile)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const normalize = path => path.replace(/^\/private(?=\/var\/)/, '')
function killGroup(pid) {
  try { process.kill(-pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error }
}
async function retireGroup(pid) {
  const deadline = Date.now() + 10000
  while (true) {
    const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,pgid='], { timeout: 5000, maxBuffer: 8_000_000 })
    const present = stdout.split('\n').some(line => Number(line.trim().split(/\s+/)[1]) === pid)
    if (!present) return
    // Unlike a second kill against an already-reaped macOS group, a denied
    // signal to an observed group is a cleanup failure, never success.
    try { process.kill(-pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    if (Date.now() >= deadline) throw new Error('Owned command group survived cleanup')
    await pause(20)
  }
}
export async function run(command, args, cwd, { timeoutMs = 120000, env = process.env } = {}) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = '', failure
  const collect = name => chunk => {
    if (name === 'stdout') stdout += chunk; else stderr += chunk
    if (stdout.length + stderr.length > 8_000_000) { failure = new Error('Owned command output exceeded8MB'); killGroup(child.pid) }
  }
  child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'))
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', () => { if (child.pid) killGroup(child.pid) }); child.once('close', (code, signal) => resolve({ code, signal })) })
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${command} exceeded ${timeoutMs}ms`)), timeoutMs) })
  const interrupt = () => { failure = new Error('Owned command interrupted'); killGroup(child.pid) }
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
  try {
    const result = await Promise.race([exit, timeout])
    if (failure) throw failure
    if (result.code !== 0) throw new Error(`${command} exited ${result.code ?? result.signal}\n${stdout}\n${stderr}`)
    return { stdout, stderr, status: result.code }
  } catch (error) {
    failure = error
    throw error
  } finally {
    clearTimeout(timer); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    if (child.pid) {
      try { await retireGroup(child.pid) }
      catch (error) { throw failure ? new AggregateError([failure, error], 'Command and cleanup failed') : error }
    }
  }
}

// Only Electron executable paths and this fixture's unique installation/profile
// identify owned processes. Never match process names or caller-supplied PIDs.
export async function ownedElectronPids(root, application) {
  const scope = normalize(realpathSync(root))
  const bundle = normalize(realpathSync(application))
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,command='], { timeout: 5000, maxBuffer: 8_000_000 })
  return stdout.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/)
    if (!match) return []
    const command = normalize(match[2]), pid = Number(match[1])
    const ownsInstall = bundle.startsWith(scope + '/')
    const ownsArgument = command.includes(scope + '/') || command.includes(scope + ' ') || command.endsWith(scope)
    const executableMatches = process.platform === 'darwin' ? command.startsWith(bundle + '/Contents/') : command === bundle || command.startsWith(bundle + ' ')
    return pid !== process.pid && executableMatches && (ownsInstall || ownsArgument) ? [pid] : []
  })
}
export async function stopOwnedElectron(root, application) {
  const deadline = Date.now() + 10000
  while (true) {
    const pids = await ownedElectronPids(root, application)
    if (!pids.length) return
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
    if (Date.now() >= deadline) throw new Error('Owned Electron processes survived cleanup')
    await pause(30)
  }
}
export async function launchOwnedElectron(command, args, root, application, env, timeoutMs = 30000) {
  let failure, result
  try { result = await run(command, args, root, { env, timeoutMs }) }
  catch (error) { failure = error }
  try { await stopOwnedElectron(root, application) }
  catch (error) { failure = failure ? new AggregateError([failure, error], 'Electron execution and cleanup failed') : error }
  if (failure) throw failure
  return result
}
export async function assertNoOwnedElectron(root, application) {
  const pids = await ownedElectronPids(root, application)
  if (pids.length) throw new Error(`Owned Electron resources remain: ${pids.join(',')}`)
}
