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

test('identical Vite fixture already on the port cannot satisfy child readiness', async () => {
  const root = join(__dirname, '..');
  const occupant = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '15382', '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITE_TOGGLY_APP_KEY: 'placeholder-core-key', VITE_TOGGLY_SECOND_APP_KEY: 'second-placeholder-key' },
  });
  let runner;
  let output = '';
  let watchdog;
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (occupant.exitCode !== null || occupant.signalCode !== null) throw new Error('identical occupant exited');
      try {
        const response = await fetch('http://127.0.0.1:15382');
        if (response.ok && (await response.text()).includes('Toggly client-core public acceptance')) break;
      } catch { /* Vite is still starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(Date.now() < deadline, 'identical occupant did not start');
    runner = spawn(process.execPath, [join(__dirname, 'browser.cjs')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [runner.stdout, runner.stderr])
      stream.on('data', chunk => { output = (output + chunk.toString()).slice(-8_000); });
    const [code] = await Promise.race([
      once(runner, 'close'),
      new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('runner needed an external watchdog')), 10_000); }),
    ]);
    assert.notEqual(code, 0, 'another identical host must not pass the runner');
    assert.match(output, /Port 15382 is already in use/);
    assert.match(output, /Vite exited before serving/);
    const response = await fetch('http://127.0.0.1:15382');
    await response.text();
    assert.ok(response.ok, 'the independently owned occupant remains available');
  } finally {
    clearTimeout(watchdog);
    if (runner && runner.exitCode === null && runner.signalCode === null) runner.kill('SIGKILL');
    if (occupant.exitCode === null && occupant.signalCode === null) {
      const exited = once(occupant, 'close');
      occupant.kill('SIGTERM');
      await exited;
    }
  }
});
