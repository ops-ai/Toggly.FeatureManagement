import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

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
    result = await work((action, timeout = 10000) =>
      actions.push({ action, timeout })
    );
  } catch (error) {
    errors.push(error);
  }
  for (const { action, timeout } of actions.reverse()) {
    try {
      await bounded(action, 'Owned cleanup', timeout);
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
    const {
      workReady = false,
      startupTimeout = 45000,
      onBrowser = () => {},
      ...spawnOptions
    } = options;
    const token = randomUUID();
    const servers = new Map();
    const child = spawn(command, args, {
      ...spawnOptions,
      env: { ...process.env, ...spawnOptions.env, TOGGLY_BROWSER_OWNER: token },
      stdio: [
        ...(Array.isArray(spawnOptions.stdio)
          ? spawnOptions.stdio
          : Array(3).fill(spawnOptions.stdio ?? 'pipe')),
        'ipc',
      ],
      detached: process.platform !== 'win32',
    });
    defer(() => stopOwnedProcess(child));
    const operations = new Set();
    let retired = false;
    const send = (message) => {
      if (child.connected) child.send({ ...message, token }, () => {});
    };
    child.on('message', (message) => {
      if (message?.token !== token || message.type !== 'toggly-browser') return;
      const operation = (async () => {
        try {
          if (message.action === 'launch') {
            if (retired || servers.has(message.id))
              throw new Error('Retired or duplicate browser request');
            // Only this supervising process launches browsers. No worker-supplied
            // PID is accepted as ownership evidence or used as a signal target.
            const moduleUrl = new URL(message.moduleUrl);
            if (
              moduleUrl.protocol !== 'file:' ||
              !moduleUrl.pathname.endsWith('/node_modules/playwright/index.mjs')
            )
              throw new Error('Expected owned host Playwright module');
            const { chromium } = await import(moduleUrl.href);
            const server = await chromium.launchServer({
              ...message.options,
              headless: true,
              timeout: 45000,
            });
            servers.set(message.id, server);
            onBrowser(server);
            if (retired) {
              await stopOwnedProcess(server.process());
              await server.close();
              return;
            }
            send({
              id: message.id,
              endpoint: server.wsEndpoint(),
              pid: server.process().pid,
            });
          } else if (message.action === 'close') {
            const server = servers.get(message.browserId);
            if (!server) throw new Error('Unknown owned browser');
            await withResources(async (cleanup) => {
              cleanup(() => stopOwnedProcess(server.process()));
              await bounded(() => server.close(), 'Browser close');
            });
            servers.delete(message.browserId);
            send({ id: message.id, closed: true });
          }
        } catch (error) {
          send({ id: message.id, error: String(error) });
        }
      })();
      operations.add(operation);
      void operation.finally(() => operations.delete(operation));
    });
    defer(async () => {
      retired = true;
      await withResources(async (cleanup) => {
        const registered = new Set();
        const register = () => {
          for (const server of servers.values()) {
            if (!registered.has(server)) {
              registered.add(server);
              ownBrowserServer(cleanup, server);
            }
          }
        };
        register();
        try {
          await bounded(
            () => Promise.allSettled([...operations]),
            'Pending browser launch',
            50000
          );
        } finally {
          register();
        }
      });
    }, 60000);
    let output = '',
      errors = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      errors += chunk;
    });
    const completed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`${command} exited ${code}\n${output}${errors}`))
      );
    });
    // A real browser's cold launch has its own bound; only ready work consumes
    // the deliberate hang deadline in blocked/abrupt retirement controls.
    if (workReady) {
      await bounded(
        () =>
          Promise.race([
            completed.then(() => {
              throw new Error('Worker exited before ready');
            }),
            new Promise((resolve) =>
              child.on('message', (message) => {
                if (
                  message?.token === token &&
                  message.type === 'toggly-work-ready'
                )
                  resolve();
              })
            ),
          ]),
        'Worker startup',
        startupTimeout
      );
    }
    await bounded(() => completed, 'Owned command', milliseconds);
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
  const { moduleUrl, ...launchOptions } = options;
  if (process.send && process.env.TOGGLY_BROWSER_OWNER) {
    if (!moduleUrl)
      throw new Error('Supervised browser requires its host module URL');
    const request = async (payload) => {
      const id = randomUUID();
      const token = process.env.TOGGLY_BROWSER_OWNER;
      let receive;
      try {
        return await bounded(
          () =>
            new Promise((resolve, reject) => {
              receive = (message) => {
                if (message?.token !== token || message.id !== id) return;
                message.error
                  ? reject(new Error(message.error))
                  : resolve(message);
              };
              process.on('message', receive);
              process.send(
                { type: 'toggly-browser', token, id, ...payload },
                (error) => {
                  if (error) reject(error);
                }
              );
            }),
          'Supervisor browser request',
          50000
        );
      } finally {
        if (receive) process.off('message', receive);
      }
    };
    const owned = await request({
      action: 'launch',
      moduleUrl,
      options: launchOptions,
    });
    defer(() => request({ action: 'close', browserId: owned.id }));
    onProcess({ pid: owned.pid });
    const browser = await bounded(
      () => chromium.connect(owned.endpoint, { timeout: 15000 }),
      'Browser connection',
      15000
    );
    defer(() => bounded(() => browser.close(), 'Browser connection close'));
    return browser;
  }
  const server = await chromium.launchServer({
    headless: true,
    timeout: 45000,
    ...launchOptions,
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
