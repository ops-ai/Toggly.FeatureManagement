const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { join } = require('node:path');

test('occupied host port fails promptly with Vite diagnostics', async () => {
  const blocker = createServer((_request, response) => response.end('wrong host'));
  blocker.listen(15382, '127.0.0.1');
  await once(blocker, 'listening');
  let child;
  let timedOut = false;
  try {
    child = spawn(process.execPath, [join(__dirname, 'browser.cjs')], {
      cwd: join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', chunk => { output = (output + chunk.toString()).slice(-8_000); });
    }
    const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 10_000);
    try {
      const [code] = await once(child, 'close');
      assert.equal(timedOut, false, 'runner needed an external watchdog');
      assert.notEqual(code, 0, 'occupied port must fail the runner');
      assert.match(output, /Port 15382 is already in use/);
      assert.match(output, /Vite exited before serving/);
    } finally {
      clearTimeout(deadline);
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    blocker.close();
    await once(blocker, 'close');
  }
});
