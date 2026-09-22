import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedCommand, withOwnedBrowser, stopChild, cleanupOwned, bounded } from './owned-resources.mjs';

const file = fileURLToPath(new URL('./browser-cleanup-worker.mjs', import.meta.url));
const primary = error => error?.cause ? primary(error.cause) : error;
const modes = ['inner-deadline', 'outer-deadline', 'abrupt-exit', 'observation-outer-deadline',
  'observation-abrupt-exit', 'observation-close-reject', 'observation-close-hang', 'startup-failure'];
for (const mode of modes) {
  test(`real supervised Chromium is reaped after ${mode}`, { timeout: 65000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'router-real-browser-cleanup-'));
    const evidence = join(root, 'pid.json'), marker = join(root, 'fail');
    const previousPath = process.env.PATH, previousMarker = process.env.ROUTER_OBSERVER_FAIL_MARKER;
    let browser, child, sentinel, failure, pid, readyAt;
    const started = Date.now();
    try {
      // The original observer fault affects the real supervisor, only after the
      // actual connection is ready and has had 750ms of ordinary observation.
      writeFileSync(join(root, 'ps'), '#!/bin/sh\nif [ -f "$ROUTER_OBSERVER_FAIL_MARKER" ]; then echo "injected process observation failure" >&2; exit 2; fi\nexec /bin/ps "$@"\n', { mode: 0o755 });
      process.env.PATH = root + ':' + previousPath;
      process.env.ROUTER_OBSERVER_FAIL_MARKER = marker;
      sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      await new Promise((resolve, reject) => { sentinel.once('spawn', resolve); sentinel.once('error', reject); });
      const remainingStartup = () => Math.max(1, 45000 - (Date.now() - started));
      const { default: puppeteer } = await bounded(() => import('puppeteer-core'), 'Browser dependency startup', remainingStartup());
      await assert.rejects(withOwnedBrowser(puppeteer, {
        executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true, userDataDir: join(root, 'profile'), args: ['--no-sandbox'], timeout: remainingStartup(),
      }, async (owned, processHandle) => {
        browser = owned; child = processHandle; pid = child.pid;
        if (mode === 'observation-close-reject') browser.close = () => Promise.reject(new Error('injected Browser close failure'));
        if (mode === 'observation-close-hang') browser.close = () => new Promise(() => {});
        return runOwnedCommand(process.execPath, [file, mode, evidence], {
          env: { ...process.env, TOGGLY_BROWSER_ENDPOINT: browser.wsEndpoint(), TOGGLY_BROWSER_PID: String(pid), TOGGLY_SENTINEL_PID: String(sentinel.pid) },
        }, 5000, {
          // Keep separate bounded dependency/connection startup and unchanged
          // five-second hung-work phase; actual Chrome already belongs to us.
          timeout: remainingStartup(),
          ready: () => { if (!existsSync(evidence)) return false; readyAt ??= Date.now(); return true; },
        });
      }), error => {
        const cause = primary(error)?.message ?? '';
        if (mode === 'startup-failure') assert.match(cause, /original worker startup failure/);
        else if (mode.includes('abrupt-exit')) assert.match(cause, /Command failed \(7\)/);
        else if (mode === 'inner-deadline') assert.match(cause, /Browser evaluation exceeded 75ms/);
        else assert.match(cause, /Packed host command exceeded 5000ms/);
        if (mode.startsWith('observation')) assert.ok(existsSync(marker), 'fault must follow actual readiness');
        return true;
      });
      if (mode !== 'startup-failure') assert.equal(JSON.parse(readFileSync(evidence, 'utf8')).browserPid, pid);
      assert.ok(child.exitCode !== null || child.signalCode !== null, 'retained browser ChildProcess must report exit');
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `owned Chrome ${pid} survived ${mode}`);
      assert.equal(sentinel.exitCode, null); assert.equal(sentinel.signalCode, null);
      process.kill(sentinel.pid, 0); // The stale registration never grants authority.
      console.log('ROUTER_REAL_CHROME_CLEANUP_PASS', JSON.stringify({ mode, browserPid: pid, alive: false, startupMs: readyAt === undefined ? null : readyAt - started, totalMs: Date.now() - started, workDeadlineMs: 5000, sentinelSurvived: true }));
    } catch (error) { failure = error; }
    finally {
      process.env.PATH = previousPath;
      if (previousMarker === undefined) delete process.env.ROUTER_OBSERVER_FAIL_MARKER; else process.env.ROUTER_OBSERVER_FAIL_MARKER = previousMarker;
      // Retained handles, not PID evidence, remain the final cleanup authority.
      await cleanupOwned([
        () => child && stopChild(child),
        () => browser?.disconnect(),
        () => stopChild(sentinel),
        () => { if (existsSync(`${evidence}.stages.json`)) console.log('ROUTER_CHROME_STARTUP_STAGES', JSON.stringify({ mode, ...JSON.parse(readFileSync(`${evidence}.stages.json`, 'utf8')) })); },
        () => rmSync(root, { recursive: true, force: true }),
      ], failure);
    }
  });
}
