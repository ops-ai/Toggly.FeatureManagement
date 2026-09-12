import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

export async function verifyBrowser(cwd, entry) {
  const dist = fs.existsSync(path.join(cwd, 'dist/browser')) ? path.join(cwd, 'dist/browser') : path.join(cwd, 'dist');
  let enabled = true;
  const requests = [];
  const server = createServer((req, res) => {
    if (req.url.startsWith('/evaluated-variants-signed/')) {
      requests.push(req.url);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ Checkout: { enabled, variant: 'control', configurationValue: null }, Disabled: { enabled: false, variant: 'control', configurationValue: null } }));
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(dist, url.pathname);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let socket;
    let activeSocketClosed = false;
    await page.routeWebSocket('**/fixture/ws**', ws => { socket = ws; activeSocketClosed = false; ws.onClose(() => { if (socket === ws) activeSocketClosed = true; }); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const rendered = async value => {
      await page.waitForFunction(value => ['component', 'flag', 'variant'].every(id => Boolean(document.getElementById(id)) === value)
        && document.getElementById('builder')?.textContent?.trim() === String(value), value);
    };
    const navigate = async (route, expected) => {
      await page.evaluate(route => window.navigate(route), route);
      await page.waitForURL(`**${expected}`);
      assert.equal(await page.locator(expected === '/denied' ? '#denied' : '#protected').count(), 1);
      await page.evaluate(() => window.navigate('/'));
    };
    await rendered(true);
    assert.equal(await page.evaluate(() => typeof window.Zone === 'undefined'), entry.mode === 'zoneless OnPush', 'host uses its declared change detection mode');
    assert.ok(requests.length > 0, 'initialization fetched definitions');
    for (const route of ['/function', '/class']) await navigate(route, route);
    await page.click('#input');
    await rendered(false);
    await page.click('#input');
    await rendered(true);
    await page.evaluate(() => window.setLocal(false));
    await rendered(false);
    for (const route of ['/function', '/class']) await navigate(route, '/denied');
    await page.evaluate(() => window.setLocal(true));
    await rendered(true);
    for (const route of ['/function', '/class']) await navigate(route, route);
    enabled = false;
    assert.ok(socket, 'SDK connected its real WebSocket');
    socket.send('update');
    await rendered(false);
    for (const route of ['/function', '/class']) await navigate(route, '/denied');
    enabled = true;
    socket.send('update');
    await rendered(true);
    for (const route of ['/function', '/class']) await navigate(route, route);
    await page.evaluate(() => window.setContext('second-user'));
    await rendered(true);
    assert.ok(requests.some(url => new URL(url, 'http://localhost').searchParams.get('userId') === 'second-user'), 'identity change reaches definitions URL');
    assert.ok(requests.some(url => new URL(url, 'http://localhost').searchParams.get('g') === 'fixture' && new URL(url, 'http://localhost').searchParams.get('claim.role') === 'test'), 'groups and claims reach definitions URL');
    await page.evaluate(() => window.destroyHost());
    await page.waitForFunction(() => !document.getElementById('input'));
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.ok(activeSocketClosed, 'destroy closes the active WebSocket');
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    console.log(`BROWSER ${entry.fixture}: input binding; component/flag/builder/variant local deny+restore and remote refresh; both guards allow+redirect; identity/groups/claims; destroy/socket close`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
