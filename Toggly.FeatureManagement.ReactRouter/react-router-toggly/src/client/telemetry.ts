import { createTelemetryReporter, type TelemetryReporter } from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';
import type { TogglyConfig } from '../core/types';

export interface FrontendTelemetry {
  recordUsage(featureKey: string, variant?: string): void;
  recordView(featureKey: string, variant?: string): void;
  incrementCounter(metricKey: string, value?: number): void;
  setGauge(metricKey: string, value: number): void;
  flushTelemetry(): Promise<void>;
}
type Attribution = {identity?: string; instanceId?: string};
type Entry = {partition: number; context: Attribution; key: string; variant?: string; kind: 'feature' | 'counter' | 'gauge'; values: number[]};

/** Render may be abandoned: keep its bounded aggregate inert until commit. */
export function createBrowserTelemetry(config: TogglyConfig) {
  const enabled = typeof window !== 'undefined' && typeof document !== 'undefined' &&
    !!config.appKey?.trim() && config.enableTelemetry !== false;
  const usage = enabled && config.enableUsageTracking !== false;
  const metrics = enabled && config.enableMetrics !== false;
  let context: Attribution = {identity: config.identity, instanceId: config.instanceId};
  let partition = 0;
  let active = false;
  let disposed = false;
  let reporter: TelemetryReporter | undefined;
  let detach: (() => void) | undefined;
  let staged = new Map<string, Entry>();
  let diagnostics = 0;
  const diagnostic = () => {
    if (diagnostics++ >= 10) return;
    try {config.onError?.('Frontend telemetry pre-commit event rejected.');} catch { /* Diagnostics are isolated. */ }
  };
  const getReporter = () => {
    if (!reporter) {
      reporter = createTelemetryReporter({appKey: config.appKey, environment: config.environment, ...context,
        metricsBaseUrl: config.metricsBaseUrl, telemetryFlushIntervalMs: config.telemetryFlushIntervalMs,
        fetch: config.telemetryFetch, onDiagnostic: code => {try {config.onError?.(code);} catch { /* Host callback. */ }}});
      detach = attachBrowserLifecycle(reporter);
    }
    return reporter;
  };
  function replay(entry: Entry) {
    const target = getReporter();
    target.setContext(entry.context);
    if (entry.kind === 'feature') {
      const methods = ['recordCheck', 'recordUsage', 'recordView'] as const;
      entry.values.forEach((count, index) => {for (let i = 0; i < count; i++) target[methods[index]](entry.key, entry.variant!);});
    } else if (entry.kind === 'gauge') target.setGauge(entry.key, entry.values[0]);
    else {
      let remaining = entry.values[0];
      do {const value = Math.min(remaining, 1000000); target.incrementCounter(entry.key, value); remaining -= value;} while (remaining > 0);
    }
    target.setContext(context);
  }
  function event(entry: Entry) {
    if (disposed || (entry.kind === 'feature' ? !usage : !metrics)) return;
    if (typeof entry.key !== 'string' || !entry.key.trim() || (entry.kind === 'feature' &&
      (typeof entry.variant !== 'string' || !entry.variant.length || entry.variant.length > 64 || /[^A-Za-z0-9_-]/.test(entry.variant))) ||
      entry.values.some(value => !Number.isFinite(value) || value < 0 || value > 1000000 || (entry.kind !== 'gauge' && !Number.isInteger(value)))) {diagnostic(); return;}
    if (active) {replay(entry); return;}
    const id = JSON.stringify([entry.partition, entry.kind === 'feature' ? 'f' : 'm', entry.key, entry.variant]);
    const previous = staged.get(id);
    if (previous && previous.kind !== entry.kind) {diagnostic(); return;}
    if (previous && entry.kind !== 'gauge') entry.values = entry.values.map((value, index) => value + previous.values[index]);
    // Reserve eventual counter chunks and feature replay operations. Both admission
    // work and activation stay bounded even when render repeats before commit.
    let operations = 0;
    let bytes = 0;
    let variants = 0;
    const entries = [...staged.entries()].filter(([key]) => key !== id).map(([, value]) => value);
    entries.push(entry);
    for (const value of entries) {
      if (value.kind === 'feature' && value.key === entry.key && value.partition === entry.partition) variants++;
      const count = value.kind === 'feature' ? value.values.reduce((a,b)=>a+b,0) : Math.max(1, Math.ceil(value.values[0] / 1000000));
      operations += count;
      const serialized = JSON.stringify({k: config.appKey, e: config.environment ?? 'Production', ...value});
      const size = new TextEncoder().encode(serialized).byteLength;
      if (size > 49152) {diagnostic(); return;}
      bytes += size * count;
    }
    if (entries.length > 2000 || operations > 2000 || bytes > 262144 || variants > 16) {diagnostic(); return;}
    staged.set(id, entry);
  }
  function feature(key: string, variant: string, index: number, attribution = context, capturedPartition = partition) {
    const values = [0,0,0]; values[index] = 1;
    event({partition: capturedPartition, context: attribution, key, variant, kind: 'feature', values});
  }
  const api: FrontendTelemetry = {
    recordUsage: (key, variant = 'enabled') => feature(key, variant, 1),
    recordView: (key, variant = 'enabled') => feature(key, variant, 2),
    incrementCounter: (key, value = 1) => event({partition, context, key, kind: 'counter', values: [value]}),
    setGauge: (key, value) => event({partition, context, key, kind: 'gauge', values: [value]}),
    flushTelemetry: async () => {await reporter?.flush();},
  };
  return {
    api,
    setContext(next: Attribution) {
      if (disposed) return;
      if (context.identity !== next.identity || context.instanceId !== next.instanceId) partition++;
      context = {identity: next.identity, instanceId: next.instanceId};
      reporter?.setContext(context);
    },
    captureCheck(): (key: string, result: boolean) => void {
      if (disposed || !usage) return () => {};
      if (active) {
        const record = getReporter().captureCheck();
        return (key, result) => record(key, result ? 'enabled' : 'disabled');
      }
      const attribution = context;
      const capturedPartition = partition;
      return (key, result) => feature(key, result ? 'enabled' : 'disabled', 0, attribution, capturedPartition);
    },
    recordCheck: (key: string, result: boolean) => feature(key, result ? 'enabled' : 'disabled', 0),
    activate() {
      if (disposed || active) return;
      active = true;
      const pending = staged; staged = new Map();
      for (const entry of pending.values()) replay(entry);
      pending.clear();
    },
    dispose(options?: {flush?: boolean}) {
      disposed = true; staged.clear(); detach?.(); reporter?.dispose(options);
    },
  };
}
