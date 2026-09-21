import { spawn } from 'node:child_process';

export async function bounded(work, label, milliseconds = 5000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
          milliseconds
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withResources(work) {
  const actions = [];
  const errors = [];
  let result;
  try {
    result = await work((action) => actions.push(action));
  } catch (error) {
    errors.push(error);
  }
  for (const action of actions.reverse()) {
    try {
      await bounded(action, 'Owned cleanup', 10000);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, 'Packed Docusaurus verification failed', {
      cause: errors[0],
    });
  return result;
}

function signal(pid, kind) {
  try {
    process.kill(pid, kind);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    // A denied existence probe is not proof of absence. During termination
    // Darwin can report EPERM until the group is reaped; keep polling.
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

// Commands and Playwright's launchServer own dedicated POSIX process groups.
// Keep their direct ownership handles; cleanup never depends on process discovery.
export async function stopOwnedProcess(child) {
  if (!child?.pid) return;
  const target = process.platform === 'win32' ? child.pid : -child.pid;
  if (!alive(target)) return;
  signal(target, 'SIGTERM');
  const wait = async (milliseconds) => {
    const until = Date.now() + milliseconds;
    while (alive(target) && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 20));
    return !alive(target);
  };
  if (!(await wait(1000))) {
    signal(target, 'SIGKILL');
    if (!(await wait(5000)))
      throw new Error('Owned process group did not exit');
  }
}

export async function runOwnedCommand(
  command,
  args,
  options = {},
  milliseconds = 180000
) {
  return withResources(async (defer) => {
    const child = spawn(command, args, {
      ...options,
      detached: process.platform !== 'win32',
    });
    defer(() => stopOwnedProcess(child));
    let output = '',
      errors = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      errors += chunk;
    });
    await bounded(
      () =>
        new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code) =>
            code === 0
              ? resolve()
              : reject(
                  new Error(`${command} exited ${code}\n${output}${errors}`)
                )
          );
        }),
      'Owned command',
      milliseconds
    );
    return output;
  });
}

export async function closeServer(server) {
  await bounded(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) =>
          error && error.code !== 'ERR_SERVER_NOT_RUNNING'
            ? reject(error)
            : resolve()
        );
        server.closeAllConnections();
      }),
    'HTTP close'
  );
}

export function ownBrowserServer(defer, server) {
  defer(() => stopOwnedProcess(server.process()));
  defer(() => bounded(() => server.close(), 'Browser close'));
}

export async function launchBrowser(
  chromium,
  defer,
  options = {},
  onProcess = () => {}
) {
  const server = await chromium.launchServer({
    headless: true,
    timeout: 45000,
    ...options,
  });
  ownBrowserServer(defer, server);
  onProcess(server.process());
  const browser = await bounded(
    () => chromium.connect(server.wsEndpoint(), { timeout: 15000 }),
    'Browser connection',
    15000
  );
  defer(() => bounded(() => browser.close(), 'Browser connection close'));
  return browser;
}

export function fetchResponse(url, init = {}, milliseconds = 5000) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.any([
      AbortSignal.timeout(milliseconds),
      ...(init.signal ? [init.signal] : []),
    ]),
  });
}
