import { appendFileSync, writeFileSync } from 'node:fs';
import { bounded, cleanupOwned } from './owned-resources.mjs';
const [mode, evidence] = process.argv.slice(2);
const stages = {};
const mark = stage => { stages[stage] = Date.now(); writeFileSync(`${evidence}.stages.json`, JSON.stringify(stages)); };
mark('importStarted');
const { default: puppeteer } = await import('puppeteer-core');
mark('importCompleted');
if (mode === 'startup-failure') throw new Error('original worker startup failure');
if (!process.env.TOGGLY_BROWSER_ENDPOINT) throw new Error('Missing supervisor browser endpoint');
const browser = await puppeteer.connect({ browserWSEndpoint: process.env.TOGGLY_BROWSER_ENDPOINT });
mark('browserConnected');
let page, failure;
try {
  // Stale registration is diagnostic input only and must never target the
  // unrelated live sentinel in either successful or failed inventory paths.
  if (process.env.TOGGLY_SENTINEL_PID) appendFileSync(process.env.TOGGLY_OWNED_PROCESS_REGISTRY,
    JSON.stringify({ pid: Number(process.env.TOGGLY_SENTINEL_PID), started: 'deliberately stale registration' }) + '\n');
  writeFileSync(evidence, JSON.stringify({ browserPid: Number(process.env.TOGGLY_BROWSER_PID) }));
  if (mode.startsWith('observation')) {
    await new Promise(resolve => setTimeout(resolve, 750));
    writeFileSync(process.env.ROUTER_OBSERVER_FAIL_MARKER, 'fail');
  }
  if (mode === 'abrupt-exit' || mode === 'observation-abrupt-exit') process.exit(7);
  page = await browser.newPage();
  const work = () => page.evaluate(() => new Promise(() => {}));
  if (mode === 'inner-deadline') await bounded(work, 'Browser evaluation', 75);
  else await work(); // Deliberately bypass local cleanup until the outer deadline.
} catch (error) { failure = error; }
// A worker owns its page and connection, never the supervisor's browser lifetime.
await cleanupOwned([() => page?.close(), () => browser.disconnect()], failure);
