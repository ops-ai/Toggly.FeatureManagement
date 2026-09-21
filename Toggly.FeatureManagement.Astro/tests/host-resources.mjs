import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

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
function processTree() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,pgid='], {encoding:'utf8',timeout:5000})
    .trim().split('\n').filter(Boolean).map(line => {
      const [pid,parent,group] = line.trim().split(/\s+/).map(Number);
      return {pid,parent,group};
    });
}
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if(error.code === 'ESRCH') return false; error.message += ` (owned PID/group ${pid})`; throw error; }
}
function signal(pid, kind) {
  try { process.kill(pid, kind); }
  catch (error) { if(error.code !== 'ESRCH') throw error; }
}
export async function stopChild(child) {
  if (!child?.pid) return;
  const tree = processTree();
  // A detached command owns its group even after the direct parent exits.
  const group = tree.some(entry => entry.group === child.pid);
  const descendants = new Set([child.pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const entry of tree) if(descendants.has(entry.parent) && !descendants.has(entry.pid)) {
      descendants.add(entry.pid); changed = true;
    }
  }
  const targets = group ? [-child.pid] : [...descendants].filter(pid => tree.some(entry => entry.pid === pid)).reverse();
  const running = () => targets.some(alive);
  if (!running()) return;
  targets.forEach(pid => signal(pid, 'SIGTERM'));
  const wait = async milliseconds => {
    const deadline = Date.now() + milliseconds;
    while(running() && Date.now() < deadline) await delay(20);
    return !running();
  };
  if (!await wait(2000)) {
    targets.forEach(pid => signal(pid, 'SIGKILL'));
    if (!await wait(5000)) throw Error('Child forced shutdown timed out');
  }
}
/** Bound headers and body together; abort also releases a held response stream. */
export async function readHttp(url, milliseconds = 5000) {
  const controller = new AbortController();
  try {
    return await bounded(async () => {
      const response = await fetch(url, {signal:controller.signal});
      return {status:response.status, headers:response.headers, body:await response.text()};
    }, 'HTTP response', milliseconds);
  } finally { controller.abort(); }
}
export function ownBrowser(defer, browser) {
  // Register process cleanup separately: a rejected/hung protocol close must not leak Chrome.
  defer(() => stopChild(browser.process()))
  defer(() => bounded(() => browser.close(), 'Browser cleanup'))
}
