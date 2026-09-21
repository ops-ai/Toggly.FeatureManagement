import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedCommand } from './owned-resources.mjs';

const file = fileURLToPath(new URL('./browser-cleanup-worker.mjs', import.meta.url));
for (const mode of ['inner-deadline', 'outer-deadline', 'abrupt-exit']) {
  test(`real detached Chromium is reaped after ${mode}`, { timeout: 65000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'router-real-browser-cleanup-'));
    let pid;
    const evidence = join(root, 'pid.json');
    try {
      const started = Date.now();
      let readyAt;
      await assert.rejects(runOwnedCommand(process.execPath, [file, mode, evidence, join(root, 'profile')], {}, 5000, {
        // Node22's cold public Puppeteer import measured11.3s in isolation and
        // fresh hosts exceeded20s under load. Startup is
        // bounded independently; the actual hung-work deadline remains 5s.
        timeout: 45000,
        ready: () => {
          if (!existsSync(evidence)) return false;
          readyAt ??= Date.now();
          return true;
        },
      }), error => {
        const cause = error.cause?.message ?? '';
        if (mode === 'outer-deadline') assert.match(cause, /Packed host command exceeded 5000ms/);
        else if (mode === 'abrupt-exit') assert.match(cause, /Command failed \(7\)/);
        else assert.match(cause, /Browser evaluation exceeded 75ms/);
        return true;
      });
      pid = JSON.parse(readFileSync(evidence, 'utf8')).browserPid;
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `owned Chrome ${pid} survived ${mode}`);
      console.log('ROUTER_REAL_CHROME_CLEANUP_PASS', JSON.stringify({ mode, browserPid: pid, alive: false, startupMs: readyAt === undefined ? null : readyAt - started, totalMs: Date.now() - started, workDeadlineMs: 5000 }));
    } finally {
      if (existsSync(`${evidence}.stages.json`)) console.log('ROUTER_CHROME_STARTUP_STAGES', JSON.stringify({ mode, ...JSON.parse(readFileSync(`${evidence}.stages.json`, 'utf8')) }));
      // Keep a failing negative control from leaking its exact owned browser.
      if (!pid && existsSync(evidence)) pid = JSON.parse(readFileSync(evidence, 'utf8')).browserPid;
      if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
      rmSync(root, { recursive: true, force: true });
    }
  });
}
