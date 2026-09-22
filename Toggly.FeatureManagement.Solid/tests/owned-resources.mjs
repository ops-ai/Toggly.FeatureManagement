import { spawn } from 'node:child_process';
export function fetchResponse(url, init = {}, milliseconds = 10000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(milliseconds) });
}
export async function bounded(work, label, milliseconds = 5000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`${label} timed out`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function withResources(work) {
  const actions = [],
    errors = [];
  let result;
  try {
    result = await work((cleanup) => actions.push(cleanup));
  } catch (error) {
    errors.push(error);
  }
  for (const action of actions.reverse())
    try {
      await bounded(action, 'owned cleanup', 15000);
    } catch (error) {
      errors.push(error);
    }
  if (errors.length)
    throw new AggregateError(errors, 'Host verification/cleanup failed', { cause: errors[0] });
  return result;
}
export async function closeServer(server) {
  if (!server.listening) return;
  await bounded(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
    'HTTP close',
  );
}
export async function stopChild(child, group = false) {
  if (!child) return;
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once('exit', resolve));
  if (group && child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  } else if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await bounded(() => exited, 'owned child exit');
}
export async function runOwned(command, args, options, timeout = 300000) {
  return withResources(async (own) => {
    const child = spawn(command, args, { ...options, detached: process.platform !== 'win32' });
    own(() => stopChild(child, true));
    await bounded(
      () =>
        new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('close', (code) =>
            code === 0 ? resolve() : reject(Error(`${command} exited ${code}`)),
          );
        }),
      command,
      timeout,
    );
  });
}
export async function launchBrowser(chromium, own, options = {}, onProcess = () => {}) {
  // Playwright Browser has no process accessor; own the launched BrowserServer.
  const server = await chromium.launchServer({ headless: true, ...options });
  own(() => stopChild(server.process(), true));
  own(() => bounded(() => server.close(), 'browser server close'));
  onProcess(server.process());
  const browser = await chromium.connect(server.wsEndpoint());
  own(() => bounded(() => browser.close(), 'browser connection close'));
  return browser;
}
