import { buildEvaluatedSignedUrl } from '@ops-ai/toggly-hooks-types';
import { InMemoryJwksCache, fetchEvaluatedSignedDefinitions } from '@ops-ai/toggly-signed-defs';
import { validateEvaluatedDefinitions } from './validation.js';
import type { BrowserOptions, TogglySnapshot, EvaluatedDefinitions } from './types.js';

/** Layout-owned lifecycle around the shared evaluated-signed transport; no rule evaluator here. */
export function connectBrowser(snapshot: TogglySnapshot, options: BrowserOptions, publish: (defs: EvaluatedDefinitions) => void): () => void {
  if (!options.appKey) return () => {};
  const baseURI = options.baseURI ?? 'https://definitions.toggly.io';
  const appKey = options.appKey;
  const url = buildEvaluatedSignedUrl(baseURI, appKey, options.environment ?? 'Production', snapshot.context, false);
  const jwks = new InMemoryJwksCache();
  let revision: string | null = null;
  let disposed = false;
  let requestId = 0;
  let active: AbortController | undefined;
  let activeTimeout: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  const report = (cause: unknown) => {
    // Observers cannot interrupt recovery, including accidentally async callbacks.
    try {
      void Promise.resolve(options.onError?.('Toggly signed refresh failed', cause)).catch(() => {
        // Rejected observers must not become unhandled refresh failures.
      });
    } catch {
      // Synchronous observers must not prevent retries or cleanup either.
    }
  };
  const refresh = async (unconditional = false, pin?: string): Promise<void> => {
    if (disposed) return;
    active?.abort();
    if (activeTimeout) clearTimeout(activeTimeout);
    const controller = new AbortController();
    active = controller;
    const ownRequest = ++requestId;
    const timeout = setTimeout(() => controller.abort(), options.timeout ?? 5000);
    activeTimeout = timeout;
    try {
      const target = new URL(url);
      if (pin) target.searchParams.set('rev', pin);
      const result = await fetchEvaluatedSignedDefinitions(target.toString(), jwks, {
        ...options, baseURI, verifySignatures: true,
        // Own the verified cache: native HTTP caching must not add validators to forced invalidations.
        fetchImpl: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: controller.signal }),
      }, { revision: unconditional ? null : revision });
      if (disposed || ownRequest !== requestId) return;
      if (result.notModified) {
        if (!revision || unconditional) throw new Error('Unexpected 304 without a matching verified snapshot');
        return;
      }
      validateEvaluatedDefinitions(result.defs);
      // HTTP confirms revisions only after verification. WS metadata never becomes a cache validator.
      revision = result.revision;
      publish(result.defs);
    } catch (cause) {
      if (!disposed && ownRequest === requestId) report(cause);
    } finally {
      clearTimeout(timeout);
      if (active === controller) { active = undefined; activeTimeout = undefined; }
    }
  };
  const invalidate = (pin?: string, rotate = false) => {
    if (disposed) return;
    if (rotate) jwks.clear();
    // An old response must not publish during the debounce window after a newer invalidation.
    requestId++;
    active?.abort();
    if (activeTimeout) clearTimeout(activeTimeout);
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = undefined; void refresh(true, pin); }, 300);
  };
  const scheduleReconnect = () => {
    if (disposed) return;
    reconnect = setTimeout(() => { reconnect = undefined; connect(); }, Math.min(5000 * 2 ** attempts++, 60000));
  };
  const connect = () => {
    if (disposed || options.enableLiveUpdates === false || typeof WebSocket === 'undefined') return;
    const target = new URL(`${baseURI.replace(/\/$/, '')}/${encodeURIComponent(appKey)}/ws`);
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    if (revision) target.searchParams.set('rev', revision);
    try {
      socket = new WebSocket(target);
      socket.onopen = () => { attempts = 0; };
      socket.onmessage = ({ data }) => {
        if (typeof data !== 'string') return;
        if (data === 'update' || data === 'flags-updated') { invalidate(); return; }
        let message: { type?: string; etag?: string; unchanged?: boolean } | null;
        try { message = JSON.parse(data); } catch { return; }
        if (!message || typeof message !== 'object') return;
        const pin = typeof message.etag === 'string' ? message.etag : undefined;
        if (message.type === 'signing-key-updated') { invalidate(undefined, true); return; }
        if (message.type === 'sync' && message.unchanged === true) return;
        if (message.type === 'update' || message.type === 'flags-updated' || message.type === 'sync') {
          if (!pin || pin !== revision) invalidate(pin);
        }
      };
      socket.onclose = () => { socket = undefined; scheduleReconnect(); };
      socket.onerror = () => { /* Browsers follow socket errors with close; polling remains the fallback. */ };
    } catch (cause) { report(cause); scheduleReconnect(); }
  };
  void refresh();
  connect();
  const interval = options.refreshInterval ?? 180000;
  const timer = interval > 0 ? setInterval(() => { if (!active && !debounce) void refresh(); }, interval) : undefined;
  return () => {
    disposed = true;
    requestId++;
    active?.abort();
    if (activeTimeout) clearTimeout(activeTimeout);
    if (timer) clearInterval(timer);
    if (reconnect) clearTimeout(reconnect);
    if (debounce) clearTimeout(debounce);
    if (socket) { socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null; socket.close(); }
  };
}
