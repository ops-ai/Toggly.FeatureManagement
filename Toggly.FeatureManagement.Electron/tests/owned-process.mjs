import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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

async function nativeCommand(command, args, root, application, env, timeoutMs) {
  let directory, preparer, preparationCompletion
  const token = `TOGGLY_OWNER_${randomUUID()} `
  let child, completion, failure, result, output = '', errors = ''
  const cleanup = []
  const interrupt = () => { failure ??= new Error('Owned command interrupted'); child?.stdin.end() }
  try {
    preparer = spawn(process.execPath, [fileURLToPath(new URL('./native-preparation-owner.mjs', import.meta.url)), token, String(timeoutMs + 100000)], {detached:true, stdio:['pipe','pipe','pipe']})
    preparer.stdin.on('error', () => {})
    let preparedResolve, preparedReject, preparationBuffer = '', preparationErrors = ''
    const prepared = new Promise((resolve, reject) => { preparedResolve = resolve; preparedReject = reject })
    preparer.stdout.on('data', chunk => {
      preparationBuffer += chunk
      let newline
      while ((newline = preparationBuffer.indexOf('\n')) >= 0) {
        const line = preparationBuffer.slice(0, newline); preparationBuffer = preparationBuffer.slice(newline + 1)
        if (!line.startsWith(token)) continue
        const event = JSON.parse(line.slice(token.length))
        if (event.prepared) preparedResolve(event.prepared)
        if (event.preparationError) preparedReject(new Error(event.preparationError))
      }
    })
    preparer.stderr.on('data', chunk => { preparationErrors += chunk })
    preparationCompletion = new Promise(resolve => {
      preparer.once('error', error => resolve({error}))
      preparer.once('close', (code, signal) => resolve({code, signal}))
    })
    preparer.stdin.write('PREPARE\n')
    directory = await bounded(Promise.race([prepared, preparationCompletion.then(value => { throw new Error(`Preparation owner exited before ready: ${JSON.stringify(value)} ${preparationErrors}`) })]), 65000, 'Preparation startup exceeded deadline')
    const executable = join(directory, 'owner')
    writeFileSync(join(directory, 'launch.json'), JSON.stringify({ command, args, token }), { mode: 0o600 })
    child = spawn(executable, [root, application, String((timeoutMs + 30000) / 1000)], { env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.on('error', () => { /* Completion/exit status remains authoritative. */ })
    let readyResolve, exitResolve, buffered = ''
    const ready = new Promise(resolve => { readyResolve = resolve })
    const exited = new Promise(resolve => { exitResolve = resolve })
    child.stdout.on('data', chunk => {
      output += chunk; buffered += chunk
      let newline
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1)
        if (!line.startsWith(token)) continue
        const event = JSON.parse(line.slice(token.length))
        if (event.ready) readyResolve()
        if (event.exit || event.launchError) exitResolve(event)
      }
      if (output.length + errors.length > 8_000_000) { failure ??= new Error('Owned command output exceeded8MB'); child.stdin.end() }
    })
    child.stderr.on('data', chunk => {
      errors += chunk
      if (output.length + errors.length > 8_000_000) { failure ??= new Error('Owned command output exceeded8MB'); child.stdin.end() }
    })
    completion = new Promise(resolve => {
      child.once('error', error => resolve({ error }))
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
    await bounded(Promise.race([ready, completion.then(value => { throw new Error(`Native supervisor exited before ready: ${JSON.stringify(value)} ${errors}`) })]), 10000, 'Native supervisor startup exceeded deadline')
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
    // The supervisor admits the command on its serial event loop. EOF before
    // admission forbids launch; afterward it retires its actual retained child.
    child.stdin.write('GO\n')
    const outcome = await bounded(Promise.race([exited, completion.then(value => { throw new Error(`Native supervisor exited before command result: ${JSON.stringify(value)} ${errors}`) })]), timeoutMs, `${command} exceeded ${timeoutMs}ms`)
    if (outcome.launchError) throw new Error(`${command}: ${outcome.launchError}`)
    if (outcome.exit.code !== 0) throw new Error(`${command} exited ${outcome.exit.code ?? outcome.exit.signal}\n${output}\n${errors}`)
    result = { stdout: output, stderr: errors, status: outcome.exit.code }
  } catch (error) { failure = failure ?? error }
  finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    // Retirement is independent of Node's late ps inventory and remains active
    // if this parent exits abruptly: its liveness pipe reaches EOF natively.
    if (child) {
      try {
        child.stdin.end()
        const value = await bounded(completion, 12000, 'Native supervisor cleanup exceeded deadline')
        if (value.error || value.code !== 0) throw new Error(`Native supervisor failed: ${JSON.stringify(value)} ${errors}`)
      } catch (error) { cleanup.push(error) }
      try { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') } catch (error) { cleanup.push(error) }
      try { await bounded(completion, 5000, 'Native supervisor process survived cleanup') } catch (error) { cleanup.push(error) }
    }
    if (preparer) {
      try {
        preparer.stdin.end()
        const value = await bounded(preparationCompletion, 12000, 'Preparation owner cleanup exceeded deadline')
        if (value.error || value.code !== 0) throw new Error(`Preparation owner failed: ${JSON.stringify(value)}`)
      } catch (error) { cleanup.push(error) }
    }
    try { if (directory) rmSync(directory, { recursive: true, force: true }) } catch (error) { cleanup.push(error) }
  }
  if (cleanup.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanup], 'Electron execution and native cleanup failed')
  if (failure) throw failure
  return result
}

export async function launchOwnedElectron(command, args, root, application, env, timeoutMs = 30000) {
  let failure, result
  try { result = process.platform === 'darwin'
    ? await nativeCommand(command, args, root, application, env, timeoutMs)
    : await run(command, args, root, { env, timeoutMs }) }
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
