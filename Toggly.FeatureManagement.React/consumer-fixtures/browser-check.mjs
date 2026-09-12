import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Resolve both tools from the isolated host, never the repository's dependency tree.
const require = createRequire(join(process.cwd(), 'package.json'))
const { preview } = await import(join(dirname(require.resolve('vite/package.json')), 'dist/node/index.js'))
const { default: puppeteer } = await import(require.resolve('puppeteer-core'))
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } })
let browser
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  let remoteEnabled = true
  const identities = []
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/definitions-fixture/')) {
      identities.push(new URL(request.url()).searchParams.get('u'))
      void request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ defs: { release: remoteEnabled, second: true } }) })
    } else void request.continue()
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  const state = async expected => {
    await page.waitForFunction(value =>
      ['flag', 'gate', 'render'].every(id => document.querySelector(`[data-testid="${id}"]`)?.textContent === value)
      && !!document.querySelector('[data-testid="visible"]') === (value === 'on')
      && !!document.querySelector('[data-testid="negated"]') === (value === 'off'),
    { timeout: 5000 }, expected)
    assert.equal(await page.$eval('[data-testid="gate"]', el => el.textContent), expected)
    assert.equal(await page.$eval('[data-testid="render"]', el => el.textContent), expected)
    assert.equal(await page.$('[data-testid="visible"]') !== null, expected === 'on')
    assert.equal(await page.$('[data-testid="negated"]') !== null, expected === 'off')
  }
  await state('on')
  assert.equal(await page.$eval('[data-testid="provider"]', el => el.textContent), 'connected')
  await page.click('#local-off')
  await state('off')
  await page.click('#local-on')
  await state('on')
  remoteEnabled = false
  await page.click('#context')
  await state('off')
  assert.ok(identities.includes('second-user'), `Context identity missing from requests: ${identities}`)
  remoteEnabled = true
  await page.click('#refresh')
  await state('on')
  // Count real service listener registrations/unsubscriptions at its public boundary.
  assert.ok(await page.evaluate(() => window.fixture.activeSubscriptions > 0))
  await page.click('#unmount')
  await page.waitForFunction(() => window.fixture.activeSubscriptions === 0)
  assert.equal(await page.$eval('#root', el => el.innerHTML), '')
  assert.deepEqual(errors, [])
  console.log('Browser: provider, hooks, all/negated/render gates, local gates, context, refresh and unmount cleanup passed')
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
