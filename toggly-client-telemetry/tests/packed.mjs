import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('.');
const host = mkdtempSync(join(tmpdir(), 'toggly-telemetry-host-'));
const env = { ...process.env, npm_config_cache: join(host, 'npm-cache') };
const run = (command, args, cwd = host) => execFileSync(command, args, { cwd, stdio: 'inherit', env });
try {
  const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', host], { cwd: root, encoding: 'utf8', env }).trim();
  writeFileSync(join(host, 'package.json'), '{"name":"telemetry-host","private":true,"type":"module"}');
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(host, tarball)]);
  const manifest = JSON.parse(readFileSync(join(host, 'node_modules/@ops-ai/toggly-client-telemetry/package.json')));
  assert.equal(manifest.name, '@ops-ai/toggly-client-telemetry'); assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  for (const extension of ['cjs', 'mjs']) {
    const load = extension === 'cjs' ? `const {createTelemetryReporter} = require('@ops-ai/toggly-client-telemetry'); const {attachBrowserLifecycle} = require('@ops-ai/toggly-client-telemetry/browser');` : `const {createTelemetryReporter} = await import('@ops-ai/toggly-client-telemetry'); const {attachBrowserLifecycle} = await import('@ops-ai/toggly-client-telemetry/browser');`;
    const program = `const oldTimeout = globalThis.setTimeout; let starts = 0; globalThis.setTimeout = (...args) => { starts++; return oldTimeout(...args); }; globalThis.fetch = () => { throw new Error('unexpected global transport'); }; delete globalThis.window; delete globalThis.document;
${load}
if (starts) throw new Error('import started work');
const disabled = createTelemetryReporter({}); attachBrowserLifecycle(disabled)(); disabled.dispose(); if (starts) throw new Error('disabled owner started work');
const calls = []; const reporter = createTelemetryReporter({appKey:'packed', fetch: async (url, init) => {calls.push({url, init}); return {status:202};}});
reporter.recordUsage('flag'); ${extension === 'cjs' ? '(async () => {' : ''}
await reporter.flush({keepalive:true}); reporter.dispose(); await reporter.flush();
if (calls.length !== 1 || JSON.parse(calls[0].init.body).f.flag.enabled[1] !== 1) throw new Error('packed transport failed');
${extension === 'cjs' ? '})().catch(e => { console.error(e); process.exitCode=1; });' : ''}`;
    writeFileSync(join(host, `consumer.${extension}`), program); run(process.execPath, [`consumer.${extension}`]);
  }
  const source = `import { createTelemetryReporter, TelemetryFetch } from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';
const fetcher: TelemetryFetch = async (_url, init) => { const aborted: boolean | undefined = init.signal?.aborted; void aborted; return {status:202}; };
const reporter = createTelemetryReporter({appKey:'type-host',fetch:fetcher}); reporter.recordCheck('flag','enabled'); reporter.recordUsage('flag'); reporter.recordView('flag'); reporter.incrementCounter('orders'); reporter.setGauge('cart',0.5); const done:Promise<void> = reporter.flush(); void done; attachBrowserLifecycle(reporter)(); reporter.dispose();
`;
  for (const extension of ['mts', 'cts']) writeFileSync(join(host, `consumer.${extension}`), source);
  writeFileSync(join(host, 'classic.ts'), source);
  writeFileSync(join(host, 'classic-browser.ts'), source + `createTelemetryReporter({appKey:'browser-classic',fetch});`);
  for (const [name, libs, file] of [['classic', ['ES2020'], 'classic.ts'], ['classic-browser', ['ES2020', 'DOM'], 'classic-browser.ts']]) {
    writeFileSync(join(host, `tsconfig.${name}.json`), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'CommonJS', moduleResolution: 'node', target: 'ES2020', lib: libs, types: [] }, files: [file] }));
  }

  writeFileSync(join(host, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'Node16', moduleResolution: 'Node16', target: 'ES2020', lib: ['ES2020'], types: [] }, include: ['consumer.mts','consumer.cts'] }));
  for (const compiler of ['typescript', 'typescript-4-8', 'typescript-4-9']) {
    run(process.execPath, [join(root, 'node_modules', compiler, 'bin/tsc'), '-p', 'tsconfig.json']);
    for (const config of ['classic', 'classic-browser']) {
      run(process.execPath, [join(root, 'node_modules', compiler, 'bin/tsc'), '-p', `tsconfig.${config}.json`]);
    }

    // Also assert native browser fetch assignability without casts.
    writeFileSync(join(host, 'browser.mts'), `import {createTelemetryReporter} from '@ops-ai/toggly-client-telemetry'; createTelemetryReporter({appKey:'x',fetch});`);
    run(process.execPath, [join(root, 'node_modules', compiler, 'bin/tsc'), '--noEmit', '--strict', '--target', 'ES2020', '--module', 'Node16', '--moduleResolution', 'Node16', '--lib', 'ES2020,DOM', 'browser.mts']);
  }
  console.log('Packed CJS/ESM runtime and TS 4.8/4.9/current DOM-free and browser consumers passed (Node16 and classic Node resolution)');
} finally { rmSync(host, { recursive: true, force: true }); }
