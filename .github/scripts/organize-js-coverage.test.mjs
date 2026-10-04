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
