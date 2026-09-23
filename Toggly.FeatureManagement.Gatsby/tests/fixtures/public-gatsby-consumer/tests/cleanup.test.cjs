const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { connect } = require('node:net');
const path = require('node:path');
const { test } = require('node:test');

const runner = path.join(__dirname, 'browser.cjs');
const ports = [8837, 8838];

for (const [name, argument, expected] of [
  ['browser startup rejection', '--inject-browser-startup-failure', 'no-such-playwright-browser'],
  ['browser connection rejection', '--inject-browser-connect-failure', 'injected browser connection failure'],
  ['browser cleanup rejection', '--inject-browser-cleanup-failure', 'injected primary browser test failure'],
  ['browser cleanup stall', '--inject-browser-cleanup-stall', 'injected primary browser test failure'],
]) {
  test(`${name} releases the real Gatsby and collector servers`, async () => {
    const child = spawn(process.execPath, [runner, argument], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, GATSBY_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });

    const exit = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`${name} runner did not exit within 25 seconds\n${output}`));
      }, 25000);
      child.once('error', error => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });

    assert.notEqual(exit.code, 0, `${name} should keep the test runner unsuccessful`);
    assert.match(output, new RegExp(expected));
    if (argument.includes('cleanup')) {
      assert.match(output, argument.endsWith('stall')
        ? /browser\.close failed: browser connection close timed out/
        : /browser\.close failed: injected pre-shutdown browser\.close rejection/,
        'cleanup failure should be reported alongside the original failure');
      assert.match(output, /Resource cleanup failed/);
    }
    const ownership = output.match(/^OWNED_RESOURCES (.+)$/m);
    assert.ok(ownership, `${name} must report owned resource IDs`);
    const { browserPid, gatsbyPort, collectorPort } = JSON.parse(ownership[1]);
    if (browserPid) assert.throws(() => process.kill(browserPid, 0), { code: 'ESRCH' }, 'Chromium process exited');
    assert.deepEqual([gatsbyPort, collectorPort], ports);
    for (const port of [gatsbyPort, collectorPort]) {
      const state = await new Promise(resolve => {
        const socket = connect({ host: '127.0.0.1', port });
        socket.once('connect', () => { socket.destroy(); resolve('OPEN'); });
        socket.once('error', error => resolve(error.code));
      });
      assert.equal(state, 'ECONNREFUSED', `port ${port} should be closed after ${name}`);
    }
  });
}
