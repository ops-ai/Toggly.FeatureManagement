import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
      // A still-live retained child pins its process-group identity. Attempt
      // its retirement before later observation, which may itself fail.
      if (child.exitCode === null && child.signalCode === null) killGroup(child.pid)
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
async function bounded(promise, ms, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms) })]) }
  finally { clearTimeout(timer) }
}

async function nativeGuardian(root, application, timeoutMs) {
  const directory = mkdtempSync(join(tmpdir(), 'toggly-electron-native-owner-'))
  let child, completion
  try {
    const executable = join(directory, 'owner')
    await run('/usr/bin/xcrun', ['swiftc', fileURLToPath(new URL('./native-electron-owner.swift', import.meta.url)), '-o', executable], directory, { timeoutMs: 60000 })
    child = spawn(executable, [root, application, String((timeoutMs + 30000) / 1000)], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.on('error', () => { /* Completion/exit status remains authoritative. */ })
    let output = '', errors = '', readyResolve
    const ready = new Promise(resolve => { readyResolve = resolve })
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('READY\n')) readyResolve() })
    child.stderr.on('data', chunk => { errors += chunk })
    completion = new Promise(resolve => {
      child.once('error', error => resolve({ error }))
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
    await bounded(Promise.race([ready, completion.then(result => { throw new Error(`Native guardian exited before ready: ${JSON.stringify(result)} ${errors}`) })]), 10000, 'Native guardian startup exceeded deadline')
    return async () => {
      let primary
      const cleanup = []
      try {
        child.stdin.end()
        const result = await bounded(completion, 12000, 'Native guardian cleanup exceeded deadline')
        if (result.error || result.code !== 0) throw new Error(`Native guardian failed: ${JSON.stringify(result)} ${errors}`)
      } catch (error) { primary = error }
      try { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') } catch (error) { cleanup.push(error) }
      try { await bounded(completion, 5000, 'Native guardian process survived cleanup') } catch (error) { cleanup.push(error) }
      try { rmSync(directory, { recursive: true, force: true }) } catch (error) { cleanup.push(error) }
      if (cleanup.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanup], 'Native guardian cleanup failed')
      if (primary) throw primary
    }
  } catch (primary) {
    const cleanup = []
    try { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') } catch (error) { cleanup.push(error) }
    try { if (completion) await bounded(completion, 5000, 'Native guardian startup cleanup exceeded deadline') } catch (error) { cleanup.push(error) }
    try { rmSync(directory, { recursive: true, force: true }) } catch (error) { cleanup.push(error) }
    throw cleanup.length ? new AggregateError([primary, ...cleanup], 'Native guardian startup and cleanup failed') : primary
  }
}

export async function launchOwnedElectron(command, args, root, application, env, timeoutMs = 30000) {
  let failure, result
  const retireNative = process.platform === 'darwin' ? await nativeGuardian(root, application, timeoutMs) : null
  try { result = await run(command, args, root, { env, timeoutMs }) }
  catch (error) { failure = error }
  // The retained native owner is independent of a later ps/discovery failure.
  try { await retireNative?.() }
  catch (error) { failure = failure ? new AggregateError([failure, error], 'Electron execution and native cleanup failed') : error }
  try { await stopOwnedElectron(root, application) }
  catch (error) { failure = failure ? new AggregateError([failure, error], 'Electron execution and cleanup failed') : error }
  if (failure) throw failure
  return result
}
export async function assertNoOwnedElectron(root, application) {
  const pids = await ownedElectronPids(root, application)
  if (pids.length) throw new Error(`Owned Electron resources remain: ${pids.join(',')}`)
}
