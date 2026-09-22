import { spawn } from 'node:child_process';
import { once } from 'node:events';

export async function bounded(work, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function stopChild(child) {
  if (!child?.pid) return;
  // Commands are created in a private process group. Kill it while its retained
  // child handle still owns the PID, then await the exit/stdio completion.
  const signal = (kind) => {
    try {
      process.kill(-child.pid, kind);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const closed =
    child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
  signal('SIGTERM');
  try {
    await bounded(() => closed, 1000, 'child termination');
  } catch {
    // Escalation below also covers descendants that ignore TERM.
  }
  signal('SIGKILL');
  await bounded(() => closed, 3000, 'child kill');
}

export async function run(command, args, cwd, env = {}, milliseconds = 180000) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
    process.stderr.write(chunk);
  });
  try {
    const [code, signal] = await bounded(
      () => once(child, 'close'),
      milliseconds,
      `${command} ${args.join(' ')}`,
    );
    if (code !== 0) throw new Error(`${command} exited ${code} (${signal})`);
    return output;
  } catch (error) {
    try {
      await stopChild(child);
    } catch (cleanupError) {
      console.error('Command cleanup failed', cleanupError);
    }
    throw error;
  }
}

// BrowserServer belongs to this supervisor, not the test worker. Its retained
// process handle supports cleanup even when the worker or graceful close fails.
export async function closeBrowser(browser) {
  if (!browser) return;
  const child = browser.process();
  try {
    await bounded(() => browser.close(), 3000, 'browser close');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      try {
        await bounded(() => browser.kill(), 2000, 'owned browser kill');
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await bounded(() => exited, 2000, 'owned browser exit');
      }
    }
  }
}

export async function cleanupAll(actions, originalError) {
  const failures = [];
  for (const action of actions) {
    try {
      await bounded(action, 8000, 'resource cleanup');
    } catch (error) {
      failures.push(error);
    }
  }
  if (originalError) {
    if (failures.length) console.error('Additional cleanup failures', failures);
    throw originalError;
  }
  if (failures.length) throw new AggregateError(failures, 'Host cleanup failed');
}
