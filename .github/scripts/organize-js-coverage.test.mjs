import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const organizerUrl = new URL('./organize-js-coverage.mjs', import.meta.url);

async function withFixture(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'toggly-js-coverage-'));
  const downloadDir = join(root, 'coverage-artifacts');
  const outputDir = join(root, 'coverage');
  mkdirSync(downloadDir);
  for (const [name, content] of Object.entries(files)) {
    const path = join(downloadDir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  try {
    assert.ok(existsSync(organizerUrl), 'the coverage organizer must exist');
    const { organizeCoverage } = await import(organizerUrl.href);
    await run({ organizeCoverage, downloadDir, outputDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const lcov = source => `TN:\nSF:${source}\nDA:1,1\nend_of_record\n`;

test('maps a flattened single artifact using its bundled name', async () => {
  await withFixture({
    'artifact-name.txt': 'coverage-Docusaurus-Pages\n',
    'lcov.info': lcov('functions/_middleware.ts'),
  }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await organizeCoverage({ downloadDir, outputDir });
    assert.match(
      readFileSync(join(outputDir, 'Docusaurus-Pages-lcov.info'), 'utf8'),
      /^SF:toggly-docusaurus-edge-sdk\/cloudflare\/pages-function\/functions\/_middleware\.ts$/m,
    );
  });
});

test('maps a flattened SolidJS artifact with its HTML report payload', async () => {
  await withFixture({
    'artifact-name.txt': 'coverage-SolidJS\n',
    'lcov.info': lcov('src/client.ts'),
    'lcov-report/index.html': '<html>SolidJS coverage</html>',
    'lcov-report/client.ts.html': '<html>client.ts</html>',
    'lcov-report/base.css': 'body { color: black; }',
  }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await organizeCoverage({ downloadDir, outputDir });
    assert.equal(
      readFileSync(join(outputDir, 'SolidJS-lcov.info'), 'utf8'),
      lcov('Toggly.FeatureManagement.Solid/src/client.ts'),
    );
  });
});

test('prefers flattened root LCOV over nested payload reports', async () => {
  await withFixture({
    'artifact-name.txt': 'coverage-SvelteKit\n',
    'lcov.info': lcov('src/server.ts'),
    'tmp/lcov.info': lcov('src/ignored.ts'),
  }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await organizeCoverage({ downloadDir, outputDir });
    assert.equal(
      readFileSync(join(outputDir, 'SvelteKit-lcov.info'), 'utf8'),
      lcov('Toggly.FeatureManagement.SvelteKit/src/server.ts'),
    );
  });
});

test('rejects flattened coverage combined with an actual named artifact without writing output', async () => {
  for (const named of [
    { 'coverage-Evaluator/lcov.info': lcov('src/engine.ts') },
    { 'coverage-SolidJS/lcov.info': lcov('src/duplicate.ts') },
    { 'coverage-Unknown/coverage-final.json': '{"src/index.ts":{}}' },
    { 'unexpected/artifact-name.txt': 'coverage-Evaluator\n' },
    { 'payload/nested/artifact-name.txt': 'coverage-Evaluator\n' },
    { 'payload/coverage-Evaluator/coverage-final.json': '{"src/engine.ts":{}}' },
  ]) {
    await withFixture({
      'artifact-name.txt': 'coverage-SolidJS\n',
      'lcov.info': lcov('src/client.ts'),
      ...named,
    }, async ({ organizeCoverage, downloadDir, outputDir }) => {
      await assert.rejects(
        organizeCoverage({ downloadDir, outputDir }),
        /Flattened and named coverage artifacts cannot be combined/,
      );
      assert.equal(existsSync(outputDir), false, 'mixed artifacts cannot produce partial scan input');
    });
  }
});

test('keeps flattened artifact validation fail-closed with HTML payloads', async () => {
  for (const [files, error] of [
    [{ 'lcov.info': lcov('src/client.ts') }, /Missing artifact name/],
    [{ 'artifact-name.txt': 'coverage-Unknown\n', 'lcov.info': lcov('src/client.ts') }, /Unknown coverage artifact/],
    [{ 'artifact-name.txt': 'coverage-SolidJS\n', 'lcov.info': 'TN:\nSF: \n' }, /no source files/],
  ]) {
    await withFixture({
      ...files,
      'lcov-report/index.html': '<html>coverage</html>',
    }, async ({ organizeCoverage, downloadDir, outputDir }) => {
      await assert.rejects(organizeCoverage({ downloadDir, outputDir }), error);
      assert.equal(existsSync(outputDir), false, 'invalid coverage cannot produce partial scan input');
    });
  }
});

test('fails when Local-Gates coverage is missing from a full bundle', async () => {
  const { REQUIRED_COVERAGE_SDKS } = await import(organizerUrl.href);
  const files = {};
  for (const sdk of REQUIRED_COVERAGE_SDKS) {
    if (sdk === 'Local-Gates') continue;
    const dir = `coverage-${sdk}`;
    files[`${dir}/artifact-name.txt`] = `coverage-${sdk}\n`;
    files[`${dir}/lcov.info`] = lcov('src/index.ts');
  }
  await withFixture(files, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await assert.rejects(
      organizeCoverage({ downloadDir, outputDir, requireFull: true }),
      /Incomplete coverage bundle.*Local-Gates/,
    );
    assert.equal(existsSync(outputDir), false);
  });
});

test('rejects a full bundle missing only the Docusaurus plugin before writing scan input', async () => {
  const { REQUIRED_COVERAGE_SDKS } = await import(organizerUrl.href);
  const files = Object.fromEntries(REQUIRED_COVERAGE_SDKS
    .filter(sdk => sdk !== 'Docusaurus')
    .map(sdk => [`coverage-${sdk}/lcov.info`, lcov('src/index.ts')]));
  await withFixture(files, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await assert.rejects(
      organizeCoverage({ downloadDir, outputDir, requireFull: true }),
      /Incomplete coverage bundle.*missing 1\): Docusaurus$/,
    );
    assert.equal(existsSync(outputDir), false);
  });
});

test('normalizes every Core and plugin source path without changing their independent line totals', async () => {
  const core = 'TN:\nSF:src/client.ts\nDA:1,3\nDA:2,0\nLF:2\nLH:1\nend_of_record\n';
  const plugin = 'TN:\nSF:src/client/index.tsx\nDA:1,2\nDA:2,1\nDA:3,0\nLF:3\nLH:2\nend_of_record\n'
    + 'TN:\nSF:src/client/setup.tsx\nDA:14,0\nLF:1\nLH:0\nend_of_record\n';
  await withFixture({
    'coverage-Client-Core/lcov.info': core,
    'coverage-Docusaurus/lcov.info': plugin,
  }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await organizeCoverage({ downloadDir, outputDir });
    assert.equal(
      readFileSync(join(outputDir, 'Client-Core-lcov.info'), 'utf8'),
      'TN:\nSF:toggly-docusaurus-edge-sdk/libs/core/src/client.ts\nDA:1,3\nDA:2,0\nLF:2\nLH:1\nend_of_record\n',
    );
    assert.equal(
      readFileSync(join(outputDir, 'Docusaurus-lcov.info'), 'utf8'),
      'TN:\nSF:toggly-docusaurus-edge-sdk/libs/docusaurus-plugin/src/client/index.tsx\nDA:1,2\nDA:2,1\nDA:3,0\nLF:3\nLH:2\nend_of_record\n'
        + 'TN:\nSF:toggly-docusaurus-edge-sdk/libs/docusaurus-plugin/src/client/setup.tsx\nDA:14,0\nLF:1\nLH:0\nend_of_record\n',
    );
  });
});

test('fails when required SDK coverage is missing from the aggregate bundle', async () => {
  await withFixture({
    'coverage-React/artifact-name.txt': 'coverage-React\n',
    'coverage-React/lcov.info': lcov('src/index.ts'),
  }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await assert.rejects(
      organizeCoverage({ downloadDir, outputDir, requireFull: true }),
      /Incomplete coverage bundle/,
    );
    assert.equal(existsSync(outputDir), false);
  });
});

test('preserves separate named artifacts with matching bundled names', async () => {
  await withFixture({
    'coverage-Evaluator/artifact-name.txt': 'coverage-Evaluator\n',
    'coverage-Evaluator/lcov.info': lcov('src/engine.ts'),
    'coverage-Node-Core/artifact-name.txt': 'coverage-Node-Core\n',
    'coverage-Node-Core/lcov.info': lcov('src/client.ts'),
    'coverage-Client-Core/artifact-name.txt': 'coverage-Client-Core\n',
    'coverage-Client-Core/lcov.info': lcov('src/index.ts'),
  }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await organizeCoverage({ downloadDir, outputDir });
    assert.match(readFileSync(join(outputDir, 'Evaluator-lcov.info'), 'utf8'), /^SF:toggly-eval\/src\/engine\.ts$/m);
    assert.match(readFileSync(join(outputDir, 'Node-Core-lcov.info'), 'utf8'), /^SF:Toggly\.FeatureManagement\.Node\/toggly-node-core\/src\/client\.ts$/m);
    assert.match(readFileSync(join(outputDir, 'Client-Core-lcov.info'), 'utf8'), /^SF:toggly-docusaurus-edge-sdk\/libs\/core\/src\/index\.ts$/m);
  });
});

test('fails when no LCOV reports were downloaded', async () => {
  await withFixture({}, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await assert.rejects(organizeCoverage({ downloadDir, outputDir }), /No LCOV reports/);
  });
});

test('fails rather than importing an unmapped or empty LCOV report', async () => {
  await withFixture({ 'coverage-Unknown/artifact-name.txt': 'coverage-Unknown\n', 'coverage-Unknown/lcov.info': lcov('src/index.ts') }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await assert.rejects(organizeCoverage({ downloadDir, outputDir }), /Unknown coverage artifact/);
  });
  await withFixture({ 'coverage-constructor/artifact-name.txt': 'coverage-constructor\n', 'coverage-constructor/lcov.info': lcov('src/index.ts') }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await assert.rejects(organizeCoverage({ downloadDir, outputDir }), /Unknown coverage artifact/);
  });
  await withFixture({ 'coverage-Evaluator/artifact-name.txt': 'coverage-Evaluator\n', 'coverage-Evaluator/lcov.info': '' }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await assert.rejects(organizeCoverage({ downloadDir, outputDir }), /no source files/);
  });
});

test('fails when flattened coverage lacks a bundled artifact name', async () => {
  await withFixture({ 'lcov.info': lcov('src/index.ts') }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await assert.rejects(organizeCoverage({ downloadDir, outputDir }), /artifact name/i);
  });
});

test('fails when a named artifact has a mismatched bundled name', async () => {
  await withFixture({
    'coverage-Evaluator/artifact-name.txt': 'coverage-Client-Core\n',
    'coverage-Evaluator/lcov.info': lcov('src/engine.ts'),
  }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await assert.rejects(organizeCoverage({ downloadDir, outputDir }), /does not match/i);
  });
});

test('fails when an artifact name has no LCOV report', async () => {
  await withFixture({
    'artifact-name.txt': 'coverage-Evaluator\n',
  }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await assert.rejects(organizeCoverage({ downloadDir, outputDir }), /No LCOV reports/);
  });
});

test('uses the top-level LCOV when an artifact also has nested reports', async () => {
  await withFixture({
    'coverage-Gatsby/artifact-name.txt': 'coverage-Gatsby\n',
    'coverage-Gatsby/lcov.info': lcov('src/utils/manifest-generator.ts'),
    'coverage-Gatsby/tmp/lcov.info': lcov('src/ignored.ts'),
  }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await organizeCoverage({ downloadDir, outputDir });
    const mapped = readFileSync(join(outputDir, 'Gatsby-lcov.info'), 'utf8');
    assert.match(mapped, /^SF:Toggly\.FeatureManagement\.Gatsby\/src\/utils\/manifest-generator\.ts$/m);
    assert.doesNotMatch(mapped, /ignored\.ts/);
  });
});

test('maps a named artifact using its folder when the bundled name is missing', async () => {
  await withFixture({
    'coverage-Angular/lcov.info': lcov('src/lib/toggly.service.ts'),
  }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await organizeCoverage({ downloadDir, outputDir });
    assert.match(
      readFileSync(join(outputDir, 'Angular-lcov.info'), 'utf8'),
      /^SF:Toggly\.FeatureManagement\.Angular\/src\/lib\/toggly\.service\.ts$/m,
    );
  });
});

test('fails the aggregate when a source-bearing named artifact lacks LCOV', async () => {
  await withFixture({
    'coverage-Client-Core/coverage-final.json': '{"src/index.ts":{}}',
    'coverage-Evaluator/artifact-name.txt': 'coverage-Evaluator\n',
    'coverage-Evaluator/lcov.info': lcov('src/engine.ts'),
  }, async ({ organizeCoverage, downloadDir, outputDir }) => {
    await assert.rejects(
      organizeCoverage({ downloadDir, outputDir }),
      /Missing LCOV report for coverage-Client-Core/,
    );
    assert.equal(existsSync(outputDir), false, 'no partial scan input is written');
  });
});
