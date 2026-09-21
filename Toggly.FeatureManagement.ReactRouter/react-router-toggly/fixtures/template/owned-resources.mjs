import { spawn, execFile } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function bounded(work, label, milliseconds = 5000) {
    let timer;
    try {
        return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds);
            })]);
    }
    finally {
        clearTimeout(timer);
    }
}
// Every independent resource receives cleanup, even when an earlier operation fails.
// Keep the original failure as the cause and first error, without relying on logging.
export async function cleanupOwned(actions, failure) {
    const errors = failure === undefined ? [] : [failure];
    for (const action of actions) {
        try {
            await bounded(action, 'Owned resource cleanup', 15000);
        }
        catch (error) {
            errors.push(error);
        }
    }
    if (errors.length)
        throw new AggregateError(errors, 'Packed host failed; all owned cleanups attempted', { cause: errors[0] });
}
export async function stopChild(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null)
        return;
    const exited = new Promise(resolve => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await bounded(() => exited, 'Owned process exit');
}
export async function closeBrowser(browser, timeout = 5000) {
    const child = browser.process();
    let failure;
    try {
        await bounded(() => browser.close(), 'Browser close', timeout);
    }
    catch (error) {
        failure = error;
    }
    await cleanupOwned([() => stopChild(child)], failure);
}
export async function closeServer(server) {
    if (!server.listening)
        return;
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await bounded(() => closed, 'HTTP server close');
}
// Dedicated process groups let the parent reap descendants even if the harness
// itself hangs or fails before it can run its local cleanup.
export async function runOwnedCommand(command, args, options, timeout = 180000, startup) {
    const registryDirectory = mkdtempSync(join(tmpdir(), 'router-owned-processes-'));
    const registry = join(registryDirectory, 'processes.jsonl');
    const child = spawn(command, args, { ...options, env: { ...(options.env ?? process.env), TOGGLY_OWNED_PROCESS_REGISTRY: registry }, detached: process.platform !== 'win32' });
    const owned = new Map();
    const collect = async () => {
      const processes = await processSnapshot();
      const root = processes.find(entry => entry.pid === child.pid);
      if (root && !owned.has(root.pid)) owned.set(root.pid, root.started);
      let records = '';
      try { records = readFileSync(registry, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const line of records.split('\n').filter(Boolean)) {
        const entry = JSON.parse(line);
        if (processes.some(process => process.pid === entry.pid && process.started === entry.started)) owned.set(entry.pid, entry.started);
      }
      // Previously recorded identities must still match before expanding their descendants.
      const current = new Set(processes.filter(entry => owned.get(entry.pid) === entry.started).map(entry => entry.pid));
      for (let changed = true; changed;) {
        changed = false;
        for (const entry of processes) if (current.has(entry.parent) && !current.has(entry.pid)) {
          current.add(entry.pid); owned.set(entry.pid, entry.started); changed = true;
        }
      }
      return processes;
    };
    // A timeout can also supervise unmodified workers. Observe descendants while
    // ancestry exists, including children in independent Chromium process groups.
    let monitorError;
    let collection;
    const monitor = setInterval(() => {
      if (collection) return;
      collection = collect().catch(error => { monitorError = error; }).finally(() => { collection = undefined; });
    }, 250);
    let output = '', errors = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { errors += chunk; });
    const exited = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`Command failed (${code ?? signal}): ${command}\n${output}${errors}`)));
    });
    // A test may gate its work deadline on real browser readiness. Dependency
    // startup has its own bound; it cannot consume or bypass the work deadline.
    void exited.catch(() => {});
    let failure;
    try {
        if (startup) await bounded(async () => {
            while (!startup.ready()) {
                if (child.exitCode !== null || child.signalCode !== null) {
                    await exited;
                    throw new Error('Owned command exited before readiness');
                }
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        }, 'Packed host startup', startup.timeout);
        await bounded(() => exited, 'Packed host command', timeout);
    }
    catch (error) {
        failure = error;
    }
    clearInterval(monitor);
    await collection;
    await cleanupOwned([async () => {
            const processes = await collect();
            for (const entry of [...processes].reverse()) {
                if (entry.pid === child.pid || owned.get(entry.pid) !== entry.started) continue;
                try { process.kill(entry.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
            }
            // Let the still-running worker reap its browser before killing the worker group.
            await new Promise(resolve => setTimeout(resolve, 100));
            if (monitorError) throw monitorError;
        }, async () => {
            if (child.pid && process.platform !== 'win32') {
                try {
                    process.kill(-child.pid, 'SIGKILL');
                }
                catch (error) {
                    if (error.code !== 'ESRCH')
                        throw error;
                }
            }
            else
                await stopChild(child);
            await bounded(() => exited.catch(() => { }), 'Command reap');
        }, async () => {
            const deadline = Date.now() + 5000;
            while ((await processSnapshot(Math.max(1, deadline - Date.now()))).some(entry => owned.get(entry.pid) === entry.started)) {
                if (Date.now() >= deadline) throw new Error('Owned descendant reap exceeded 5000ms');
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        }, () => rmSync(registryDirectory, { recursive: true, force: true })], failure);
    return output;
}

// Puppeteer may put Chromium outside the Node worker's process group. Record its
// exact process identity before browser work so even abrupt worker exit is recoverable.
export async function registerOwnedBrowser(browser) {
  const pid = browser.process()?.pid;
  const file = process.env.TOGGLY_OWNED_PROCESS_REGISTRY;
  if (!pid || !file) return;
  const entry = (await processSnapshot()).find(entry => entry.pid === pid);
  if (entry) appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

function processSnapshot(timeout = 5000) {
  if (process.platform === 'win32') return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    execFile('ps', ['-axo', 'pid=,ppid=,lstart='], { encoding: 'utf8', timeout, killSignal: 'SIGKILL' }, (error, output) => {
      if (error) { reject(error); return; }
      resolve(output.split('\n').flatMap(line => {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
        return match ? [{ pid: Number(match[1]), parent: Number(match[2]), started: match[3].trim() }] : [];
      }));
    });
  });
}
