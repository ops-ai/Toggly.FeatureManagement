import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const workflowsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../workflows');

test('sdk release workflows publish through npm-publish-if-absent.sh', () => {
  const workflows = fs
    .readdirSync(workflowsDir)
    .filter((name) => name.startsWith('sdk-') && name.endsWith('-release.yml'));
  const publishers = [];
  const raw = [];

  for (const name of workflows) {
    const text = fs.readFileSync(path.join(workflowsDir, name), 'utf8');
    const publishes = /(?:npm|pnpm) publish\b/.test(text);
    if (!publishes) continue;
    publishers.push(name);
    if (!text.includes('npm-publish-if-absent.sh')) {
      raw.push(`${name} does not call npm-publish-if-absent.sh`);
    }
    for (const line of text.split('\n')) {
      if (/^\s*(?:npm|pnpm) publish\b/.test(line)) {
        raw.push(`${name}: ${line.trim()}`);
      }
    }
  }

  assert.ok(publishers.length >= 20, `expected npm publish workflows, saw ${publishers.length}`);
  assert.deepEqual(raw, []);
});
