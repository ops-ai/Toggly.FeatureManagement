import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import {
  ensureTogglySegmentsDist,
  togglySegmentsDistPath,
} from './ensure-toggly-segments-dist.mjs';

test('togglySegmentsDistPath points at dist/index.js', () => {
  assert.equal(togglySegmentsDistPath('/repo/toggly-segments'), '/repo/toggly-segments/dist/index.js');
});

test('ensureTogglySegmentsDist skips npm when dist/index.js exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'segments-dist-'));
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist', 'index.js'), 'export {};\n');
  const calls = [];
  const built = await ensureTogglySegmentsDist(root, async (args) => {
    calls.push(args);
  });
  assert.equal(built, false);
  assert.deepEqual(calls, []);
});

test('ensureTogglySegmentsDist installs and builds when dist is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'segments-missing-'));
  const calls = [];
  const built = await ensureTogglySegmentsDist(root, async (args) => {
    calls.push(args);
    if (args[0] === 'run' && args[1] === 'build') {
      await mkdir(join(root, 'dist'), { recursive: true });
      await writeFile(join(root, 'dist', 'index.js'), 'export {};\n');
    }
  });
  assert.equal(built, true);
  assert.deepEqual(calls[0], ['ci']);
  assert.deepEqual(calls.at(-1), ['run', 'build']);
});

test('ensureTogglySegmentsDist falls back to npm install when ci fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'segments-install-'));
  const calls = [];
  await ensureTogglySegmentsDist(root, async (args) => {
    calls.push(args);
    if (args[0] === 'ci') throw new Error('no lockfile');
    if (args[0] === 'run' && args[1] === 'build') {
      await mkdir(join(root, 'dist'), { recursive: true });
      await writeFile(join(root, 'dist', 'index.js'), 'export {};\n');
    }
  });
  assert.deepEqual(calls[0], ['ci']);
  assert.deepEqual(calls[1], ['install']);
});
