// Each child imports the built package into a fresh process and key cache.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv[2]) {
  const { createClient } = await import('../dist/index.js');
  const path = process.argv[3];
  const records = JSON.parse(readFileSync(path, 'utf8'));
  const storage = {
    getItem: (key) => records[key] ?? null,
    setItem: (key, value) => {
      records[key] = value;
      writeFileSync(path, JSON.stringify(records));
    },
  };
  const requests = [];
  if (process.argv[2] === 'online') {
    const { envelope, jwks } = await import('./fixtures/service.mjs');
    globalThis.fetch = async (input) =>
      new Response(
        String(input).includes('.well-known') ? JSON.stringify(jwks) : envelope({ on: true }),
      );
  } else {
    globalThis.fetch = async (input) => {
      requests.push(String(input));
      throw new Error('Every network request disabled');
    };
  }
  const client = createClient({ appKey: 'front', identity: 'alice', storage });
  await client.refresh();
  assert.equal(client.evaluate(['on']), true);
  client.dispose();
  process.stdout.write(JSON.stringify(requests));
} else {
  const directory = mkdtempSync(join(tmpdir(), 'solid-offline-process-'));
  try {
    const path = join(directory, 'storage.json');
    writeFileSync(path, '{}');
    const script = fileURLToPath(import.meta.url);
    execFileSync(process.execPath, [script, 'online', path]);
    const requests = JSON.parse(
      execFileSync(process.execPath, [script, 'offline', path], { encoding: 'utf8' }),
    );
    assert.equal(requests.length, 1);
    assert.match(requests[0], /\/evaluated-signed\//);
    console.log(
      'Built package restores verified definitions in a new process with every network request disabled.',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
