// Import the built SDK in two different processes so no in-memory keys survive.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv[2]) {
  const { createToggly } = await import('../dist/index.js');
  globalThis.window = {};
  const path = process.argv[3];
  const records = JSON.parse(readFileSync(path, 'utf8'));
  const storage = {
    getItem: key => records[key] ?? null,
    setItem: (key, value) => { records[key] = value; writeFileSync(path, JSON.stringify(records)); },
  };
  const requests = [];
  let failed;
  const failure = new Promise(resolve => { failed = resolve; });
  if (process.argv[2] === 'online') {
    const { computeKid } = await import('@ops-ai/toggly-signed-defs');
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const key = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const kid = await computeKid(key.x, key.y);
    const defs = { on: true };
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(defs) + '|' + timestamp));
    const signature = Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, digest)).toString('base64');
    globalThis.fetch = async input => new Response(String(input).includes('.well-known')
      ? JSON.stringify({ keys: [{ ...key, kid, alg: 'ES256' }] })
      : JSON.stringify({ defs, timestamp, kid, signature }));
  } else {
    globalThis.fetch = async input => { requests.push(String(input)); throw new Error('Every network request disabled'); };
  }
  const client = createToggly({ definitions: {}, context: { identity: 'alice' }, expose: ['on'], source: 'defaults' }, {
    appKey: 'front', storage, enableLiveUpdates: false, refreshInterval: 0, onError: () => failed(),
  });
  const enabled = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Offline restoration failed')), 3000);
    client.subscribe(snapshot => { if (snapshot.definitions.on) { clearTimeout(timeout); resolve(); } });
  });
  await client.start();
  await enabled;
  if (process.argv[2] === 'offline') await failure;
  assert.equal(client.isEnabled('on'), true);
  client.dispose();
  process.stdout.write(JSON.stringify(requests));
} else {
  const directory = mkdtempSync(join(tmpdir(), 'sveltekit-offline-process-'));
  try {
    const path = join(directory, 'storage.json');
    writeFileSync(path, '{}');
    const script = fileURLToPath(import.meta.url);
    execFileSync(process.execPath, [script, 'online', path]);
    const requests = JSON.parse(execFileSync(process.execPath, [script, 'offline', path], { encoding: 'utf8' }));
    assert.equal(requests.length, 1);
    assert.match(requests[0], /\/evaluated-signed\//);
    console.log('Built SvelteKit package restores signed definitions in a new process with every network request disabled.');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
