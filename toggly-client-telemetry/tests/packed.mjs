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
  const sourceManifest = JSON.parse(readFileSync(join(root, 'package.json')));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
  assert.equal(manifest.version, sourceManifest.version, 'packed version must match the source manifest');
  assert.equal(lock.version, manifest.version, 'lockfile version must match the packed release');
  assert.equal(lock.packages[''].version, manifest.version, 'root lockfile package must match the packed release');
  for (const extension of ['cjs', 'mjs']) {
    const load = extension === 'cjs' ? `const {createTelemetryReporter, attachClientSystemMetrics, ClientSystemMetricsCollector, attachBrowserExceptionSources, attachReactNativeExceptionSources, CLIENT_SYSTEM_METRICS_INTERVAL_MS, CLIENT_SYSTEM_METRICS_MAX_PENDING} = require('@ops-ai/toggly-client-telemetry'); const {attachBrowserLifecycle} = require('@ops-ai/toggly-client-telemetry/browser');` : `const {createTelemetryReporter, attachClientSystemMetrics, ClientSystemMetricsCollector, attachBrowserExceptionSources, attachReactNativeExceptionSources, CLIENT_SYSTEM_METRICS_INTERVAL_MS, CLIENT_SYSTEM_METRICS_MAX_PENDING} = await import('@ops-ai/toggly-client-telemetry'); const {attachBrowserLifecycle} = await import('@ops-ai/toggly-client-telemetry/browser');`;
    const program = `const oldTimeout = globalThis.setTimeout; let starts = 0; globalThis.setTimeout = (...args) => { starts++; return oldTimeout(...args); }; globalThis.fetch = () => { starts++; throw new Error('unexpected global transport'); }; delete globalThis.window; delete globalThis.document; globalThis.setInterval = () => { starts++; throw new Error('unexpected global interval'); }; globalThis.PerformanceObserver = class { constructor() { starts++; throw new Error('unexpected observer'); } };
${load}
if (starts) throw new Error('import started work');
for (const exported of [attachClientSystemMetrics, ClientSystemMetricsCollector, attachBrowserExceptionSources, attachReactNativeExceptionSources]) if (typeof exported !== 'function') throw new Error('missing packed metrics export');
for (const exported of [CLIENT_SYSTEM_METRICS_INTERVAL_MS, CLIENT_SYSTEM_METRICS_MAX_PENDING]) if (typeof exported !== 'number') throw new Error('missing packed metrics constant');
const disabled = createTelemetryReporter({}); attachBrowserLifecycle(disabled)(); attachClientSystemMetrics(disabled, {})(); attachClientSystemMetrics(disabled, {systemMetrics:true, enableTelemetry:false})(); disabled.dispose(); if (starts) throw new Error('disabled owner started work');
const calls = []; const reporter = createTelemetryReporter({appKey:'packed', fetch: async (url, init) => {calls.push({url, init}); return {status:202};}});
reporter.recordUsage('flag'); const capturedCheck = reporter.captureCheck(); reporter.setContext({instanceId:'mint',identity:'ignored'}); reporter.incrementCounter('orders'); reporter.setContext({identity:'alice'}); reporter.setGauge('cart',2); capturedCheck('Evaluated','disabled'); ${extension === 'cjs' ? '(async () => {' : ''}
await reporter.flush({keepalive:true}); reporter.dispose(); await reporter.flush();
if (calls.length !== 4 || JSON.parse(calls[0].init.body).f.flag.enabled[1] !== 1 || JSON.parse(calls[1].init.body).i !== 'mint' || JSON.parse(calls[2].init.body).u !== 'alice' || JSON.parse(calls[3].init.body).f.Evaluated.disabled[0] !== 1 || JSON.parse(calls[3].init.body).u !== undefined) throw new Error('packed context transport failed');
const metricCalls = []; const metricReporter = createTelemetryReporter({appKey:'metrics',fetch:async (_url,init)=>{metricCalls.push(JSON.parse(init.body));return {status:202};},_runtime:{gzip:async()=>undefined}});
let sample; let stopped = false; const handle = {}; const observed = [{metric:'ExceptionCount',value:2},{metric:'LongTaskCount',value:3},{metric:'MemoryBytes',value:4}];
const detachMetrics = attachClientSystemMetrics(metricReporter,{systemMetrics:true,sampler:()=>observed,setIntervalFn:tick=>{sample=tick;return handle;},clearIntervalFn:timer=>{if(timer!==handle)throw new Error('wrong metrics timer');stopped=true;}});
if (typeof sample !== 'function') throw new Error('packed metrics sampler did not start'); sample(); sample(); await metricReporter.flush({keepalive:true});
if (metricCalls.length!==1 || metricCalls[0].m.ExceptionCount!==4 || metricCalls[0].m.LongTaskCount!==6 || metricCalls[0].m.MemoryBytes!==4) throw new Error('packed metrics transport failed');
detachMetrics(); sample(); await metricReporter.flush({keepalive:true}); if (!stopped || metricCalls.length!==1) throw new Error('packed metrics cleanup failed'); metricReporter.dispose({flush:false});
const discarded = createTelemetryReporter({appKey:'discarded',fetch:async()=>{throw new Error('discard sent');}}); discarded.incrementCounter('no-send'); discarded.dispose({flush:false}); await discarded.flush();
${extension === 'cjs' ? '})().catch(e => { console.error(e); process.exitCode=1; });' : ''}`;
    writeFileSync(join(host, `consumer.${extension}`), program); run(process.execPath, [`consumer.${extension}`]);
  }
  const source = `import { createTelemetryReporter, TelemetryFetch, TelemetryContext, attachClientSystemMetrics, ClientSystemMetricsCollector, attachBrowserExceptionSources, attachReactNativeExceptionSources, CLIENT_SYSTEM_METRICS_INTERVAL_MS, CLIENT_SYSTEM_METRICS_MAX_PENDING, AttachClientSystemMetricsOptions, ClientSystemMetricObservation, ClientSystemMetricsClearInterval, ClientSystemMetricsCollectorOptions, ClientSystemMetricsSampler, ClientSystemMetricsSetGauge, ClientSystemMetricsSetInterval, ClientSystemMetricsTimerHandle } from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';
const fetcher: TelemetryFetch = async (_url, init) => { const aborted: boolean | undefined = init.signal?.aborted; void aborted; return {status:202}; };
const reporter = createTelemetryReporter({appKey:'type-host',fetch:fetcher}); const context: TelemetryContext = {instanceId:'mint',identity:'alice'}; reporter.setContext(context); const check: (key: string, variant: string) => void = reporter.captureCheck(); check('captured','enabled'); reporter.recordCheck('flag','enabled'); reporter.recordUsage('flag'); reporter.recordView('flag'); reporter.incrementCounter('orders'); reporter.setGauge('cart',0.5); const done:Promise<void> = reporter.flush(); void done; attachBrowserLifecycle(reporter)(); reporter.dispose({flush:false});
const observation: ClientSystemMetricObservation = {metric:'ExceptionCount',value:1};
const sampler: ClientSystemMetricsSampler = () => [observation];
const handle: ClientSystemMetricsTimerHandle = {unref:()=>{}};
const setIntervalFn: ClientSystemMetricsSetInterval = (_tick, _ms) => handle;
const clearIntervalFn: ClientSystemMetricsClearInterval = (_handle) => {};
const setGauge: ClientSystemMetricsSetGauge = (metric, value) => reporter.setGauge(metric,value);
const options: AttachClientSystemMetricsOptions = {systemMetrics:true,enableTelemetry:true,reactNativeExceptions:true,intervalMs:CLIENT_SYSTEM_METRICS_INTERVAL_MS,sampler,setIntervalFn,clearIntervalFn};
const detach: () => void = attachClientSystemMetrics(reporter, options); detach();
const collectorOptions: ClientSystemMetricsCollectorOptions = {setGauge,sampler,setIntervalFn,clearIntervalFn,attachExceptionSources:attachBrowserExceptionSources};
const collector = new ClientSystemMetricsCollector(collectorOptions); collector.start(); collector.tick(); collector.onFlushed(); collector.stop();
const detachNative: () => void = attachReactNativeExceptionSources(()=>{}); detachNative(); const pendingLimit: number = CLIENT_SYSTEM_METRICS_MAX_PENDING; void pendingLimit;
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
    for (const extension of ['mts', 'cts']) writeFileSync(join(host, `browser.${extension}`), source + `createTelemetryReporter({appKey:'x',fetch});`);
    run(process.execPath, [join(root, 'node_modules', compiler, 'bin/tsc'), '--noEmit', '--strict', '--target', 'ES2020', '--module', 'Node16', '--moduleResolution', 'Node16', '--lib', 'ES2020,DOM', 'browser.mts', 'browser.cts']);
  }
  console.log('Packed CJS/ESM runtime and TS 4.8/4.9/current DOM-free and browser consumers passed (Node16 and classic Node resolution)');
} finally { rmSync(host, { recursive: true, force: true }); }
