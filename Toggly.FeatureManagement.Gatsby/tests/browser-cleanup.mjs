import assert from 'node:assert/strict';
import { bounded, cleanupOwned, closeBrowser, diagnoseFailure } from './owned-resources.mjs';

export async function runBrowserCleanupControls(chromium, launchOptions = {}) {
  const server = await chromium.launchServer({ headless: true, ...launchOptions });
  const pid = server.process().pid;
  let browser;
  let original;
  const started = Date.now();
  try {
    browser = await chromium.connect(server.wsEndpoint());
    const page = await browser.newPage();
    try {
      await bounded(() => page.evaluate(() => new Promise(() => {})), 'Held browser evaluation', 75);
    } catch (failure) {
      original = await diagnoseFailure(failure, () => page.evaluate(() => new Promise(() => {})), 75);
    }
    assert.match(original?.message ?? '', /Held browser evaluation exceeded 75ms/);
    await assert.rejects(cleanupOwned([
      () => bounded(() => browser.close(), 'Browser connection close'),
      () => closeBrowser(server),
    ], original), error => error.cause === original && error.errors[0] === original);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    console.log('GATSBY_REAL_HELD_BROWSER_CLEANUP_PASS', JSON.stringify({ pid, alive: false, totalMs: Date.now() - started, original: original.message }));
  } finally {
    // Failure of a negative control must not leak its isolated real browser.
    await cleanupOwned([
      () => browser && bounded(() => browser.close(), 'Browser connection close'),
      () => closeBrowser(server),
    ]);
  }
}
