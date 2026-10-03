import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('./sdk-php-release.yml', import.meta.url), 'utf8');

test('PHP release validate no-ops when the SDK tree is absent', () => {
  assert.match(workflow, /id: check/);
  assert.match(workflow, /present=false/);
  assert.match(
    workflow,
    /action: \$\{\{ steps\.check\.outputs\.present == 'true' && steps\.release\.outputs\.action \|\| 'skip' \}\}/,
  );
  assert.match(workflow, /if: steps\.check\.outputs\.present == 'true'/);
  assert.doesNotMatch(workflow, /::error::.*composer\.json was not found/);
  assert.match(workflow, /if: needs\.validate\.outputs\.action == 'publish'/);
});
