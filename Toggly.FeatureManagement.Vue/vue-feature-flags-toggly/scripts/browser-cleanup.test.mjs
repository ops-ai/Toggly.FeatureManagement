import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createServer, Server} from 'node:http'
import {test} from 'node:test'
import {verifyBrowser} from './browser-check.mjs'

async function probe(scenario) {
  const servers = [], children = []
  const listen = Server.prototype.listen
  Server.prototype.listen = function(...args) {servers.push(this); return listen.apply(this, args)}
  const startChild = () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio: 'ignore'})
    const exited = new Promise(resolve => child.once('exit', resolve))
    children.push({child, exited})
    return {child, exited}
  }
  const launch = async () => {
    if (scenario === 'launch-failure') throw Error('launch failed')
    const {child, exited} = startChild()
    return {
      process: () => child,
      newPage: async () => {throw Error('verification failed')},
      close: async () => {
        if (scenario === 'close-failure') throw Error('protocol close failed')
        if (scenario === 'close-timeout') return new Promise(() => {})
        child.kill('SIGTERM'); await exited
      },
    }
  }
  try {
    if (scenario === 'negative-listener') await new Promise(resolve => createServer().listen(0, '127.0.0.1', resolve))
    if (scenario === 'negative-child') startChild()
    const messages = error => [String(error), ...(error.errors ?? []).flatMap(messages)].join('\n')
    await assert.rejects(verifyBrowser(launch), error => {
      assert.match(messages(error), scenario === 'launch-failure' ? /launch failed/ : /verification failed/)
      if (scenario === 'close-failure') assert.match(messages(error), /protocol close failed/)
      if (scenario === 'close-timeout') assert.match(messages(error), /Browser cleanup timed out/)
      return true
    })
    assert.ok(servers.length >= 2)
    assert.equal(servers.filter(server => server.listening).length, 0, 'owned listener leaked')
    assert.equal(children.filter(({child}) => child.exitCode === null && child.signalCode === null).length, 0, 'owned process leaked')
  } finally {
    Server.prototype.listen = listen
    await Promise.all(servers.map(server => new Promise(resolve => {server.close(resolve); server.closeAllConnections()})))
    await Promise.all(children.map(async ({child, exited}) => {child.kill('SIGKILL'); await exited}))
  }
}
for (const scenario of ['launch-failure', 'verification-failure', 'close-failure', 'close-timeout']) {
  test(`cleans real listeners and owned children after ${scenario}`, {timeout: 10000}, () => probe(scenario))
}
for (const scenario of ['negative-listener', 'negative-child']) {
  test(`detects deliberately leaked ${scenario}`, {timeout: 10000}, () => assert.rejects(probe(scenario), scenario === 'negative-listener' ? /owned listener leaked/ : /owned process leaked/))
}
