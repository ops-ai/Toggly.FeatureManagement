import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runOwnedCommand,
  withResources,
  ownBrowserServer,
} from './owned-resources.mjs';

/** Real browser controls: only the supervisor retains the BrowserServer handle. */
export async function verifyBrowserRetirement(moduleUrl, options = {}) {
  for (const phase of ['blocked', 'abrupt']) {
    await withResources(async (defer) => {
      const root = mkdtempSync(
        join(tmpdir(), 'docusaurus-browser-retirement-')
      );
      defer(() => rmSync(root, { recursive: true, force: true }));
      const owned = [];
      defer(() =>
        withResources(async (cleanup) => {
          for (const server of owned) ownBrowserServer(cleanup, server);
        })
      );
      const marker = join(root, 'browser.json');
      const worker = join(root, 'worker.mjs');
      writeFileSync(
        worker,
        `
        import { writeFileSync } from 'node:fs';
        import { chromium } from ${JSON.stringify(moduleUrl)};
        import { withResources, launchBrowser } from ${JSON.stringify(new URL('./owned-resources.mjs', import.meta.url).href)};
        await withResources(async defer => {
          const browser = await launchBrowser(chromium, defer, ${JSON.stringify({ ...options, moduleUrl })}, child => writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ browser: child.pid, worker: process.pid })));
          const page = await browser.newPage();
          void page.evaluate(() => new Promise(() => {}));
          process.send({ type: 'toggly-work-ready', token: process.env.TOGGLY_BROWSER_OWNER }, () => {
            ${phase === 'blocked' ? 'while (true) {}' : "process.kill(process.pid, 'SIGKILL')"}
          });
          await new Promise(() => {});
        });
      `
      );
      await assert.rejects(
        runOwnedCommand(
          process.execPath,
          [worker],
          {
            workReady: true,
            startupTimeout: 60000,
            onBrowser: (server) => owned.push(server),
          },
          300
        ),
        (error) =>
          phase === 'blocked'
            ? /Owned command exceeded/.test(error.cause?.message)
            : /exited null/.test(error.cause?.message)
      );
      const pids = JSON.parse(readFileSync(marker));
      assert.equal(owned.length, 1);
      assert.equal(pids.browser, owned[0].process().pid);
      for (const pid of Object.values(pids))
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      console.log('PACKED_DOCUSAURUS_BROWSER_RETIREMENT_PASS', phase, pids);
    });
  }
}
