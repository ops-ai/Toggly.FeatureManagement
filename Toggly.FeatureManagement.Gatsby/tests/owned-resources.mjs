import { spawn, execFile } from 'node:child_process';
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
export async function runOwnedCommand(command, args, options, timeout = 180000) {
    const child = spawn(command, args, { ...options, detached: process.platform !== 'win32' });
    let diagnosticTimer;
    if (options.env?.TOGGLY_GATSBY_BUILD_DIAGNOSTICS === '1') {
        const started = Date.now();
        console.log('GATSBY_OWNED_BUILD_START', JSON.stringify({ pid: child.pid, started }));
        child.once('exit', (code, signal) => console.log('GATSBY_OWNED_BUILD_EXIT', JSON.stringify({ pid: child.pid, code, signal, elapsedMs: Date.now() - started })));
        child.once('close', (code, signal) => console.log('GATSBY_OWNED_BUILD_CLOSE', JSON.stringify({ pid: child.pid, code, signal, elapsedMs: Date.now() - started })));
        diagnosticTimer = setTimeout(() => {
            execFile('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,comm='], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' }, (error, output) => {
                if (error) { console.error('GATSBY_BUILD_PROCESS_DIAGNOSTIC_FAILURE', error.message); return; }
                const rows = output.split('\n').flatMap(line => {
                    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
                    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), state: match[4], executable: match[5] }] : [];
                });
                const owned = new Set([child.pid]);
                for (let changed = true; changed;) {
                    changed = false;
                    for (const row of rows) if ((owned.has(row.parent) || row.group === child.pid) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; }
                }
                console.error('GATSBY_SLOW_BUILD_PROCESS_TREE', JSON.stringify({ elapsedMs: Date.now() - started, rootExitCode: child.exitCode, processes: rows.filter(row => owned.has(row.pid)) }));
            });
        }, 45000);
        diagnosticTimer.unref();
    }
    let output = '', errors = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { errors += chunk; });
    const exited = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`Command failed (${code ?? signal}): ${command}\n${output}${errors}`)));
    });
    let failure;
    try {
        await bounded(() => exited, 'Packed host command', timeout);
    }
    catch (error) {
        failure = error;
    }
    clearTimeout(diagnosticTimer);
    await cleanupOwned([async () => {
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
        }], failure);
    return output;
}

// Diagnostics are best effort, but may never replace the triggering failure or
// delay resource cleanup indefinitely when the browser itself is unresponsive.
export async function diagnoseFailure(failure, diagnostics, milliseconds = 5000) {
    try { await bounded(diagnostics, 'Browser diagnostics', milliseconds); }
    catch (error) { console.error('Browser diagnostics unavailable', error.message); }
    return failure;
}
