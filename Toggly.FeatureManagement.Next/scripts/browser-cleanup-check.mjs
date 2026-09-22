import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {Server, createServer} from 'node:http'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {verifyBrowser} from './browser-check.mjs'
import {closeServer, stopChild} from './host-resources.mjs'
const require = createRequire(join(process.cwd(), 'package.json'))
const {default: puppeteer} = await import(require.resolve('puppeteer-core'))
const scenario = process.argv[2]
if (scenario) {
  const servers = [], children = []
  const listen = Server.prototype.listen
  Server.prototype.listen = function(...args) {servers.push(this); return listen.apply(this, args)}
  let originalClose
  try {
    if (scenario === 'negative-control-listener') await new Promise(resolve => createServer().listen(0, '127.0.0.1', resolve))
    if (scenario === 'negative-control-child') {
      const unowned = await puppeteer.launch({executablePath:process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true,args:['--no-sandbox']})
      children.push(unowned.process())
    }
    const launch = async () => {
      const browser = await puppeteer.launch({executablePath:scenario === 'launch-failure' ? '/missing-next-test-chrome' : process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true,args:['--no-sandbox']})
      children.push(browser.process())
      originalClose = browser.close.bind(browser)
      browser.newPage = async () => {throw Error('intentional verification failure')}
      if (scenario === 'close-failure') browser.close = async () => {throw Error('intentional close failure')}
      if (scenario === 'close-timeout') browser.close = () => new Promise(() => {})
      return browser
    }
    let failure
    try {await verifyBrowser(0, launch)} catch(error) {failure = error}
    assert.ok(failure)
    const messages = error => [String(error), ...(error.errors ?? []).flatMap(messages)].join('\n')
    assert.match(messages(failure), scenario === 'launch-failure' ? /missing-next-test-chrome/ : /intentional verification failure/)
    if (scenario === 'close-failure') assert.match(messages(failure), /intentional close failure/)
    if (scenario === 'close-timeout') assert.match(messages(failure), /Browser cleanup timed out/)
    assert.ok(servers.length > 0)
    if (scenario !== 'launch-failure') assert.ok(children.length > 0)
    assert.equal(servers.filter(server=>server.listening).length, 0, 'owned HTTP listener leaked')
    assert.equal(children.filter(child=>child.exitCode===null && child.signalCode===null).length, 0, 'owned Chrome child leaked')
  } finally {
    await Promise.allSettled(servers.map(closeServer))
    await Promise.allSettled(children.map(stopChild))
    if(originalClose) await originalClose().catch(()=>{})
  }
} else {
  for (const fixture of ['launch-failure', 'verification-failure', 'close-failure', 'close-timeout', 'negative-control-listener', 'negative-control-child']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), fixture], {encoding:'utf8', env:process.env, timeout:30000})
    assert.equal(result.error, undefined, `cleanup probe must exit without process timeout: ${result.error}`)
    if (fixture.startsWith('negative-control-')) {
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.match(result.stderr, fixture.endsWith('listener') ? /owned HTTP listener leaked/ : /owned Chrome child leaked/)
    } else assert.equal(result.status, 0, result.stdout + result.stderr)
    console.log(`Browser cleanup probe passed: ${fixture}`)
  }
}
