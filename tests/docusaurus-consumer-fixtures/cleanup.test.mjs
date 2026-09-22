import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bounded,
  closeServer,
  fetchResponse,
  runOwnedCommand,
  stopOwnedProcess,
  withResources,
} from './owned-resources.mjs';

for (const failure of [
  'launch',
  'body',
  'close',
  'close-timeout',
  'artifact',
  'logging',
]) {
  test(`independent cleanup after ${failure} failure`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'docusaurus-cleanup-'));
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      detached: true,
      stdio: 'ignore',
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    console.log('OWNED_CHILD', failure, child.pid);
    const server = createServer((_, response) => response.end('owned'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await assert.rejects(
        withResources(async (defer) => {
          defer(() => rmSync(root, { recursive: true, force: true }));
          defer(() => closeServer(server));
          defer(() => stopOwnedProcess(child));
          defer(() =>
            failure === 'close-timeout'
              ? bounded(() => new Promise(() => {}), 'Injected close', 25)
              : Promise.reject(new Error(failure))
          );
          if (['launch', 'body'].includes(failure)) throw new Error(failure);
        }),
        /Packed Docusaurus verification failed/
      );
      assert.equal(server.listening, false);
      assert.equal(existsSync(root), false);
      assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
    } finally {
      await stopOwnedProcess(child);
      await closeServer(server);
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('deadline kills the actual command and its descendant', async () => {
  const root = mkdtempSync(join(tmpdir(), 'docusaurus-command-'));
  const file = join(root, 'pids');
  try {
    const code = `const{spawn}=require('node:child_process');const{writeFileSync}=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(process.argv[1],JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000)`;
    await assert.rejects(
      runOwnedCommand(process.execPath, ['-e', code, file], {}, 250),
      (error) => /Owned command exceeded/.test(error.cause.message)
    );
    for (const pid of JSON.parse(readFileSync(file)))
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a parent that already exited cannot orphan its owned descendant group', async () => {
  const root = mkdtempSync(join(tmpdir(), 'docusaurus-exit-'));
  const file = join(root, 'pid');
  try {
    const code = `const{spawn}=require('node:child_process');const{writeFileSync}=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(process.argv[1],String(c.pid));c.unref()`;
    await runOwnedCommand(process.execPath, ['-e', code, file]);
    assert.throws(() => process.kill(Number(readFileSync(file)), 0), {
      code: 'ESRCH',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deliberately missing ownership is detected by a real live process probe', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  try {
    await withResources(async () => {}); // Negative control: deliberately omit process cleanup.
    assert.doesNotThrow(() => process.kill(child.pid, 0));
    assert.throws(
      () => assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' }),
      assert.AssertionError
    );
  } finally {
    await stopOwnedProcess(child);
  }
});

test('a denied actual termination remains an error and never counts as cleanup', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  const kill = process.kill;
  try {
    process.kill = function (pid, signal) {
      if (pid === -child.pid && signal === 'SIGTERM')
        throw Object.assign(new Error('Denied termination'), { code: 'EPERM' });
      return kill.call(process, pid, signal);
    };
    await assert.rejects(stopOwnedProcess(child), { code: 'EPERM' });
    assert.doesNotThrow(() => kill.call(process, child.pid, 0));
  } finally {
    process.kill = kill;
    await stopOwnedProcess(child);
  }
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
});

for (const phase of ['headers', 'body']) {
  test(`held HTTP ${phase} aborts before listener cleanup`, async () => {
    const server = createServer((_, response) => {
      if (phase === 'body') {
        response.writeHead(200);
        response.write('partial');
      }
    });
    await withResources(async (defer) => {
      defer(() => closeServer(server));
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      await assert.rejects(async () => {
        const response = await fetchResponse(
          `http://127.0.0.1:${server.address().port}`,
          {},
          50
        );
        await response.text();
      });
      assert.equal(
        server.listening,
        true,
        'the request deadline precedes owned cleanup'
      );
    });
    assert.equal(server.listening, false);
  });
}
