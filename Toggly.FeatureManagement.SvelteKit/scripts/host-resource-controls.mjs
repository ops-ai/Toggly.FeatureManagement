import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { bounded, run, closeBrowser, cleanupAll, stopChild } from './host-resources.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};
async function gone(pid) {
  for (let i = 0; i < 60; i++) {
    if (!alive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Owned PID ${pid} survived cleanup`);
}
await assert.rejects(run(process.execPath, ['-e', 'process.exit(17)'], root), /exited 17/);
console.log('CONTROL unsuccessful command remains unsuccessful');
const dir = await mkdtemp(join(tmpdir(), 'sveltekit-cleanup-'));
try {
  const pidFile = join(dir, 'descendant');
  const program = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'}); fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); setInterval(()=>{},1000);`;
  await assert.rejects(run(process.execPath, ['-e', program], root, {}, 1500), /exceeded 1500ms/);
  await gone(Number(await readFile(pidFile, 'utf8')));
  console.log('CONTROL command deadline reaps TERM-resistant descendant');
} finally {
  try {
    const pid = Number(await readFile(join(dir, 'descendant'), 'utf8'));
    if (alive(pid)) process.kill(pid, 'SIGKILL');
  } catch {}
  await rm(dir, { recursive: true, force: true });
}

for (const mode of ['graceful', 'close-rejects', 'close-hangs', 'close-and-kill-rejects']) {
  const browser = await chromium.launchServer({ headless: true, timeout: 30000 });
  const pid = browser.process().pid;
  const originalClose = browser.close.bind(browser);
  if (mode === 'close-rejects' || mode === 'close-and-kill-rejects')
    browser.close = async () => {
      throw new Error('injected close rejection');
    };
  if (mode === 'close-hangs') browser.close = () => new Promise(() => {});
  if (mode === 'close-and-kill-rejects')
    browser.kill = async () => {
      throw new Error('injected kill rejection');
    };
  try {
    assert(alive(pid)); // Deliberate-leak negative control must detect the real browser first.
    if (mode === 'graceful') await closeBrowser(browser);
    else
      await assert.rejects(
        closeBrowser(browser),
        /injected close rejection|injected kill rejection|browser close exceeded/,
      );
    await gone(pid);
    console.log(`CONTROL actual browser ${mode}: PID ${pid} gone`);
  } finally {
    browser.close = originalClose;
    if (alive(pid)) {
      browser.process().kill('SIGKILL');
      await gone(pid);
    }
  }
}

// The browser is owned here, outside the hung worker and its process group.
// Startup readiness is separate from the unchanged five-second work deadline.
const temporary = await mkdtemp(join(tmpdir(), 'sveltekit-worker-control-'));
const browser = await chromium.launchServer({ headless: true, timeout: 30000 });
const browserPid = browser.process().pid;
browser.close = async () => {
  throw new Error('injected graceful close failure during worker timeout');
};
const server = createServer((_req, res) => res.end('owned'));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = `http://127.0.0.1:${server.address().port}`;
const worker = spawn(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `import {chromium} from '@playwright/test'; const browser=await chromium.connect(process.env.CONTROL_ENDPOINT);const page=await browser.newPage(); await page.goto('about:blank'); process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send('ready'); await page.evaluate(()=>new Promise(()=>{})).catch(()=>new Promise(()=>{}));`,
  ],
  {
    cwd: root,
    detached: true,
    env: { ...process.env, CONTROL_ENDPOINT: browser.wsEndpoint() },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  },
);
let failure;
const started = performance.now();
try {
  await bounded(() => once(worker, 'message'), 30000, 'browser worker startup');
  console.log('CONTROL worker startup ms', performance.now() - started);
  assert(alive(browserPid));
  assert(alive(worker.pid));
  await bounded(() => once(worker, 'exit'), 5000, 'hung browser worker');
  assert.fail('Hung browser work unexpectedly completed');
} catch (error) {
  failure = error;
}
try {
  await assert.rejects(
    cleanupAll(
      [
        () => closeBrowser(browser),
        () => stopChild(worker),
        async () => {
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        },
        () => rm(temporary, { recursive: true, force: true }),
      ],
      failure,
    ),
    /hung browser worker exceeded 5000ms/,
  );
  await gone(browserPid);
  await gone(worker.pid);
  await assert.rejects(fetch(address, { signal: AbortSignal.timeout(500) }));
  await assert.rejects(access(temporary));
  console.log(
    'CONTROL actual hung browser worker: original timeout retained, worker/browser/listener/temp gone',
    { browserPid, workerPid: worker.pid },
  );
} finally {
  if (alive(browserPid)) browser.process().kill('SIGKILL');
  await stopChild(worker);
  server.closeAllConnections();
  server.close();
  await rm(temporary, { recursive: true, force: true });
}
console.log('All 7 owned-resource controls passed');
