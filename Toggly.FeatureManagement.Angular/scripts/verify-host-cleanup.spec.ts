import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { verifyBrowser } from './verify-host-browser.spec.ts';
import { withHostResources } from './host-resources.spec.ts';

const probe = process.argv.indexOf('--probe');
if (probe !== -1) {
  const scenario = process.argv[probe + 1];
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'toggly-angular-cleanup-probe-'));
  const servers = [];
  const children = [];
  const closeBrowsers = [];
  const listen = http.Server.prototype.listen;
  http.Server.prototype.listen = function (...args) { servers.push(this); return listen.apply(this, args); };
  const wrapBrowser = browser => {
    closeBrowsers.push(browser.close.bind(browser));
    children.push(...process._getActiveHandles().filter(handle => handle.constructor?.name === 'ChildProcess'));
    browser.newPage = async () => { throw new Error('intentional verification failure'); };
    if (scenario === 'close-failure') browser.close = async () => { throw new Error('intentional browser close failure'); };
    if (scenario === 'close-timeout') browser.close = () => new Promise(() => {});
    return browser;
  };
  for (const method of ['launch', 'connect']) {
    const original = chromium[method].bind(chromium);
    chromium[method] = async (...args) => wrapBrowser(await original(...args));
  }
  const launchServer = chromium.launchServer.bind(chromium);
  chromium.launchServer = async (...args) => {
    const server = await launchServer(...args);
    if (scenario === 'server-close-failure') server.close = async () => { throw new Error('intentional Chrome server close failure'); };
    return server;
  };
  let failure;
  try {
    if (scenario === 'launch-failure') process.env.CHROME_BIN = path.join(cwd, 'missing-chrome');
    if (scenario === 'negative-control-listener') await new Promise(resolve => http.createServer().listen(0, '127.0.0.1', resolve));
    if (scenario === 'negative-control-child') await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN });
    try { await verifyBrowser(cwd, { fixture: 'cleanup-probe' }); } catch (error) { failure = error; }
    assert.ok(failure, 'failed verification must reject');
    const messages = error => [String(error), ...(error.errors ?? []).flatMap(messages)].join('\n');
    assert.match(messages(failure), scenario === 'launch-failure' ? /missing-chrome/ : /intentional verification failure/);
    if (scenario === 'close-failure') assert.match(messages(failure), /intentional browser close failure/);
    if (scenario === 'close-timeout') assert.match(messages(failure), /Chrome connection cleanup timed out/);
    if (scenario === 'server-close-failure') assert.match(messages(failure), /intentional Chrome server close failure/);
    assert.ok(servers.length >= 2, 'probe must acquire real HTTP listeners');
    if (scenario !== 'launch-failure') assert.ok(children.length > 0, 'probe must acquire a real Chrome child');
    const leakedServers = servers.filter(server => server.listening).length;
    const leakedChildren = children.filter(child => child.exitCode === null && child.signalCode === null).length;
    console.log(JSON.stringify({ scenario, leakedServers, leakedChildren }));
    assert.equal(leakedServers, 0, 'every owned HTTP listener must close after failure');
    assert.equal(leakedChildren, 0, 'every owned Chrome child must exit after failure');
  } finally {
    // Rescue deliberately broken baseline/negative-control implementations only after measuring leaks.
    await Promise.allSettled(closeBrowsers.map(close => close()));
    await Promise.allSettled(servers.map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })));
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    fs.rmSync(cwd, { recursive: true, force: true });
  }
} else {
  test('attempts independent temporary-directory cleanup and preserves operation and cleanup errors', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toggly-angular-cleanup-errors-'));
    const good = path.join(root, 'good'); const bad = path.join(root, 'bad');
    fs.mkdirSync(good); fs.mkdirSync(bad);
    try {
      await assert.rejects(withHostResources(async defer => {
        defer(() => fs.rmSync(good, { recursive: true }));
        defer(() => fs.rmSync(bad)); // A real EISDIR failure must not skip the independent cleanup.
        throw new Error('original verification error');
      }), error => error instanceof AggregateError && error.errors.length === 2
        && error.errors[0].message === 'original verification error' && error.errors[1].code === 'ERR_FS_EISDIR');
      assert.equal(fs.existsSync(good), false);
      assert.equal(fs.existsSync(bad), true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('packed runner removes its npm shim, hosts and tarball after an early matrix failure', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toggly-angular-runner-cleanup-'));
    try {
      const script = fileURLToPath(new URL('./verify-host-fixtures.spec.ts', import.meta.url));
      const npmCli = process.env.npm_execpath ?? fs.realpathSync(path.join(path.dirname(process.execPath), 'npm'));
      const result = spawnSync(process.execPath, [script], {
        encoding: 'utf8', timeout: 30000,
        env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root, npm_execpath: npmCli, NODE_DISABLE_COMPILE_CACHE: '1', TOGGLY_HOST: 'intentionally-missing' },
      });
      assert.equal(result.error, undefined, `runner must exit without a process timeout: ${result.error}`);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /TOGGLY_HOST selected no fixtures/);
      assert.deepEqual(fs.readdirSync(root), [], 'all runner-owned temporary resources must be removed');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  for (const scenario of ['launch-failure', 'verification-failure', 'close-failure', 'close-timeout', 'server-close-failure', 'negative-control-listener', 'negative-control-child']) {
    test(`cleans real owned listeners and browser children after ${scenario}`, () => {
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--probe', scenario], {
        encoding: 'utf8', env: process.env, timeout: 30000,
      });
      assert.equal(result.error, undefined, `cleanup probe must exit without a process timeout: ${result.error}`);
      if (scenario.startsWith('negative-control-')) {
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stderr, scenario.endsWith('listener') ? /every owned HTTP listener must close/ : /every owned Chrome child must exit/);
      } else {
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /"leakedServers":0,"leakedChildren":0/);
      }
    });
  }
}
