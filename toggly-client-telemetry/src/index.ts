import type { TelemetryOptions, TelemetryReporter, TelemetryDiagnostic, TelemetryResponse } from './types.js';
import { registerOwner, removeOwner } from './lifecycle.js';
export type { TelemetryOptions, TelemetryReporter, TelemetryDiagnostic, TelemetryFetch, TelemetryResponse, TelemetryRequestInit, TelemetryAbortSignal } from './types.js';

type Entry = { key: string; variant?: string; kind: 'feature' | 'counter' | 'gauge'; values: number[] };
type Envelope = { k: string; e: string; i?: string; u?: string; f?: Record<string, Record<string, number[]>>; m?: Record<string, number> };
const MAX_VALUE = 1000000;
const MAX_BYTES = 49152;
const MAX_BUFFER = 262144;
const MAX_ENTRIES = 2000;
const EXPIRY = 300000;

// UTF-8 byte count without TextEncoder (not present in some native JS hosts).
function bytes(value: string): number {
  let size = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) size++;
    else if (code < 0x800) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { size += 4; i++; }
    else size += 3;
  }
  return size;
}
function write(envelope: Envelope, entry: Entry, values: number[]): void {
  if (entry.kind === 'feature') {
    const trimmed = values.slice();
    while (trimmed.length > 1 && trimmed[trimmed.length - 1] === 0) trimmed.pop();
    envelope.f ??= Object.create(null);
    envelope.f![entry.key] ??= Object.create(null);
    envelope.f![entry.key][entry.variant!] = trimmed;
  } else { envelope.m ??= Object.create(null); envelope.m![entry.key] = values[0]; }
}
async function nativeGzip(json: string): Promise<ArrayBuffer | undefined> {
  if (typeof CompressionStream === 'undefined' || typeof Response === 'undefined' || typeof Blob === 'undefined') return undefined;
  return new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}
function validName(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function validVariant(value: unknown): value is string {
  // An end-anchor alone can accept a final newline in JavaScript regexes.
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && !/[^A-Za-z0-9_-]/.test(value);
}

/** Create one owner per client instance. Importing this package starts no work. */
export function createTelemetryReporter(options: TelemetryOptions): TelemetryReporter {
  const key = options.appKey;
  const enabled = options.enableTelemetry !== false && validName(key);
  let disposed = false;
  let diagnosticCount = 0;
  function diagnostic(code: TelemetryDiagnostic): void {
    if (diagnosticCount++ >= 10) return;
    try { options.onDiagnostic?.(code); } catch { /* Diagnostics never affect clients. */ }
  }
  const now = options._runtime?.now ?? Date.now;
  const random = options._runtime?.random ?? Math.random;
  const gzip = options._runtime?.gzip ?? nativeGzip;
  const environment = options.environment ?? 'Production';
  const base = options.metricsBaseUrl ?? 'https://metrics.toggly.io';
  let url = '';
  try {
    const parsed = new URL(base);
    // URL.search/hash omit empty delimiters, so reject them in the input too.
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || /[?#]/.test(base)) throw new Error();
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/api/frontend/telemetry';
    url = parsed.href;
  } catch { if (enabled) diagnostic('invalid-option'); }
  const configured = options.telemetryFlushIntervalMs ?? 45000;
  const interval = Number.isFinite(configured) && configured >= 30000 && configured <= 60000 ? configured : 45000;
  if (enabled && interval !== configured) diagnostic('invalid-option');
  const fetcher = options.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
  let pending = new Map<string, Entry>();
  let snapshot: Map<string, Entry> | undefined;
  let running: Promise<void> | undefined;
  let requested = false;
  let keepalive = false;
  let finalRemaining = 0;
  let periodic: ReturnType<typeof setTimeout> | undefined;
  let cancelRetry: (() => void) | undefined;
  let cleanups: Set<() => void> | undefined;
  const instanceId = validName(options.instanceId) ? options.instanceId.trim() : '';
  const identity = validName(options.identity) ? options.identity.trim() : '';
  const empty = (): Envelope => {
    const envelope: Envelope = { k: key!, e: environment };
    if (instanceId) envelope.i = instanceId;
    else if (identity) envelope.u = identity;
    return envelope;
  };
  const chunk = (entry: Entry): number[] => entry.values.map(v => Math.min(MAX_VALUE, v));
  function cost(entry: Entry): { count: number; size: number } {
    const count = Math.max(1, ...entry.values.map(v => Math.ceil(v / MAX_VALUE)));
    const envelope = empty(); write(envelope, entry, chunk(entry));
    // Conservatively reserve each eventual chunk as a complete envelope. This
    // bounds packetization as well as wire buffers, without allocating chunks.
    return { count, size: bytes(JSON.stringify(envelope)) * count };
  }
  function allEntries(): Entry[] { return [...(snapshot?.values() ?? []), ...pending.values()]; }
  function accept(entry: Entry): void {
    if (!enabled || disposed || !url) return;
    const id = JSON.stringify([entry.kind === 'feature' ? 'f' : 'm', entry.key, entry.variant]);
    const old = pending.get(id);
    const entries = allEntries();
    if (entries.some(e => e.key === entry.key && e.kind !== 'feature' && entry.kind !== 'feature' && e.kind !== entry.kind)) { diagnostic('metric-kind-conflict'); return; }
    if (entry.kind === 'feature') {
      const variants = new Set(entries.filter(e => e.kind === 'feature' && e.key === entry.key).map(e => e.variant));
      if (!variants.has(entry.variant) && variants.size >= 16) { diagnostic('buffer-full'); return; }
    }
    if (old && entry.kind !== 'gauge') entry.values = entry.values.map((v, i) => v + old.values[i]);
    const proposed = cost(entry);
    if (proposed.size / proposed.count > MAX_BYTES) { diagnostic('invalid-event'); return; }
    let count = proposed.count; let size = proposed.size;
    for (const existing of entries) {
      if (existing === old) continue;
      const used = cost(existing); count += used.count; size += used.size;
    }
    if (count > MAX_ENTRIES || size > MAX_BUFFER) { diagnostic('buffer-full'); return; }
    pending.set(id, entry);
  }
  function feature(featureKey: string, variant: string, index: number): void {
    if (!enabled || disposed) return;
    if (!validName(featureKey) || !validVariant(variant)) { diagnostic('invalid-event'); return; }
    const values = [0, 0, 0]; values[index] = 1;
    accept({ key: featureKey, variant, kind: 'feature', values });
  }
  function metric(metricKey: string, value: number, kind: 'counter' | 'gauge'): void {
    if (!enabled || disposed) return;
    if (!validName(metricKey) || !Number.isFinite(value) || value < 0 || value > MAX_VALUE || (kind === 'counter' && !Number.isInteger(value))) { diagnostic('invalid-event'); return; }
    accept({ key: metricKey, kind, values: [value] });
  }
  function schedule(): void {
    if (!enabled || disposed || !url) return;
    periodic = setTimeout(() => { periodic = undefined; void reporter.flush().then(schedule); }, Math.round(interval * (0.8 + 0.4 * random())));
  }
  async function attempt(body: string, exit: boolean): Promise<TelemetryResponse | undefined> {
    const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const work = async (): Promise<TelemetryResponse | undefined> => {
      let compressed: ArrayBuffer | undefined;
      if (!exit) {
        try { compressed = await gzip(body); } catch { diagnostic('compression-fallback'); }
      }
      if (expired) return undefined;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (compressed) headers['Content-Encoding'] = 'gzip';
      return fetcher?.(url, { method: 'POST', credentials: 'omit', headers, body: compressed ?? body, keepalive: exit, signal: controller?.signal });
    };
    try {
      return await Promise.race([work(), new Promise<undefined>(resolve => {
        timeout = setTimeout(() => { expired = true; controller?.abort(); resolve(undefined); }, 5000);
      })]);
    } catch { return undefined; }
    finally { if (timeout !== undefined) clearTimeout(timeout); }
  }
  function wait(delay: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(finish, delay);
      function finish(): void { clearTimeout(timer); cancelRetry = undefined; resolve(); }
      cancelRetry = finish;
    });
  }
  async function send(body: string, born: number, exit: boolean): Promise<void> {
    for (let attemptNumber = 0; attemptNumber < 3; attemptNumber++) {
      const response = await attempt(body, exit);
      if (response?.status === 202) return;
      if (disposed || !response || ![429, 503].includes(response.status) || attemptNumber === 2) { diagnostic('transport-drop'); return; }
      let delay = attemptNumber === 0 ? 30000 : 60000;
      try {
        const retry = response.headers?.get('Retry-After');
        if (retry) {
          const seconds = Number(retry);
          const until = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - now();
          if (Number.isFinite(until)) delay = Math.max(delay, until);
        }
      } catch { /* Unreadable Retry-After retains the default delay. */ }
      if (now() + delay >= born + EXPIRY) { diagnostic('transport-drop'); return; }
      await wait(delay);
      if (disposed || now() >= born + EXPIRY) return;
    }
  }
  async function drain(): Promise<void> {
    do {
      requested = false;
      snapshot = pending; pending = new Map();
      const born = now();
      while (snapshot.size && (!disposed || finalRemaining > 0)) {
        const envelope = empty();
        const selected: [string, Entry, number[]][] = [];
        for (const [id, entry] of snapshot) {
          const values = chunk(entry);
          write(envelope, entry, values);
          if (bytes(JSON.stringify(envelope)) > MAX_BYTES) {
            if (entry.kind === 'feature') {
              delete envelope.f![entry.key][entry.variant!];
              if (!Object.keys(envelope.f![entry.key]).length) delete envelope.f![entry.key];
              if (!Object.keys(envelope.f!).length) delete envelope.f;
            } else { delete envelope.m![entry.key]; if (!Object.keys(envelope.m!).length) delete envelope.m; }
            break;
          }
          selected.push([id, entry, values]);
        }
        if (!selected.length) break;
        if (disposed) finalRemaining--;
        await send(JSON.stringify(envelope), born, keepalive || disposed);
        for (const [id, entry, values] of selected) {
          entry.values = entry.values.map((v, i) => v - values[i]);
          if (entry.values.every(v => v === 0)) snapshot.delete(id);
        }
        if (now() >= born + EXPIRY) break;
      }
      snapshot = undefined;
    } while ((requested || disposed) && pending.size && (!disposed || finalRemaining > 0));
    if (disposed) pending.clear();
  }
  const reporter: TelemetryReporter = {
    recordCheck: (featureKey, variant) => feature(featureKey, variant, 0),
    recordUsage: (featureKey, variant = 'enabled') => feature(featureKey, variant, 1),
    recordView: (featureKey, variant = 'enabled') => feature(featureKey, variant, 2),
    incrementCounter: (metricKey, value = 1) => metric(metricKey, value, 'counter'),
    setGauge: (metricKey, value) => metric(metricKey, value, 'gauge'),
    flush(flushOptions) {
      if (!enabled || !url || (disposed && finalRemaining === 0 && !running)) return Promise.resolve();
      keepalive ||= flushOptions?.keepalive === true;
      requested = true;
      running ??= (async () => {
        // Defer entry until running owns the flight, including empty flushes.
        await Promise.resolve();
        try {
          do { await drain(); } while (requested && pending.size && (!disposed || finalRemaining > 0));
        } finally { running = undefined; keepalive = false; }
      })();
      return running;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (periodic !== undefined) clearTimeout(periodic);
      cancelRetry?.();
      cleanups?.forEach(detach => detach()); cleanups?.clear(); removeOwner(reporter);
      if (!enabled) return;
      finalRemaining = 1; keepalive = true;
      void reporter.flush();
    },
  };
  if (enabled && url) { cleanups = registerOwner(reporter); schedule(); }
  return reporter;
}
