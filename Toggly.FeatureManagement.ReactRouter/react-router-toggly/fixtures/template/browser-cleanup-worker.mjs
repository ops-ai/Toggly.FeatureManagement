import { writeFileSync } from 'node:fs';
import { bounded, cleanupOwned, closeBrowser, registerOwnedBrowser } from './owned-resources.mjs';
const [mode, evidence, profile] = process.argv.slice(2);
const stages = {};
const mark = stage => { stages[stage] = Date.now(); writeFileSync(`${evidence}.stages.json`, JSON.stringify(stages)); };
mark('importStarted');
const { default: puppeteer } = await import('puppeteer-core');
mark('importCompleted');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: profile, args: ['--no-sandbox'] });
mark('browserLaunched');
let failure;
try {
  await registerOwnedBrowser(browser);
  mark('browserRegistered');
  writeFileSync(evidence, JSON.stringify({ browserPid: browser.process().pid }));
  if (mode === 'abrupt-exit') process.exit(7); // Deliberate detached-browser leak: the parent must reap it.
  const page = await browser.newPage();
  const work = () => page.evaluate(() => new Promise(() => {}));
  if (mode === 'inner-deadline') await bounded(work, 'Browser evaluation', 75);
  else await work(); // Deliberately bypass local cleanup until the outer deadline.
} catch (error) { failure = error; }
await cleanupOwned([() => closeBrowser(browser)], failure);
