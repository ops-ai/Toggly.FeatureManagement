import { buildEvaluatedSignedUrl } from '@ops-ai/toggly-hooks-types';
import {
  InMemoryJwksCache,
  fetchEvaluatedSignedDefinitions,
  type JwkSet,
} from '@ops-ai/toggly-signed-defs';
import { validateEvaluatedDefinitions } from './validation.js';
import { createPersistence, verifyEnvelope } from './persistence.js';
import { captureEvaluatedResponse } from './transport.js';
import type { BrowserOptions, TogglySnapshot, EvaluatedDefinitions } from './types.js';

/** Trusted key and timestamp state survives browser reconnects within one layout. */
export interface BrowserSession {
  timestamps: Map<string, number>;
  keys: Map<string, JwkSet>;
}

/** Layout-owned lifecycle around the shared evaluated-signed transport; no rule evaluator here. */
export function connectBrowser(
  snapshot: TogglySnapshot,
  options: BrowserOptions,
  publish: (
    defs: EvaluatedDefinitions,
    verification?: Pick<TogglySnapshot, 'signedTimestamp' | 'signingKey'>,
  ) => void,
  session: BrowserSession = { timestamps: new Map(), keys: new Map() },
): () => void {
  if (!options.appKey) return () => {};
  const baseURI = options.baseURI ?? 'https://definitions.toggly.io';
  const appKey = options.appKey;
  const { timestamps, keys: observedKeys } = session;
  const url = buildEvaluatedSignedUrl(
    baseURI,
    appKey,
    options.environment ?? 'Production',
    snapshot.context,
    false,
  );
  let jwks = new InMemoryJwksCache();
  const persistence = createPersistence(options.storage, baseURI);
  // Authoritative SSR/manual state must never be replaced by an older cache.
  let mayRestore = snapshot.source === 'defaults';
  if (snapshot.source === 'signed') {
    if (Number.isSafeInteger(snapshot.signedTimestamp)) {
      timestamps.set(url, Math.max(timestamps.get(url) ?? 0, snapshot.signedTimestamp!));
    }
    if (snapshot.signingKey)
      observedKeys.set(baseURI, { keys: [structuredClone(snapshot.signingKey)] });
  }
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
  // Restore once per connection; newer live state must never be replaced by storage.
  const restoreCached = (ownRequest: number): Promise<void> | undefined => {
    const cached = mayRestore
      ? persistence.read(url, options, timestamps.get(url) ?? 0, observedKeys.get(baseURI))
      : undefined;
    mayRestore = false;
    return cached
      ?.then((restored) => {
        if (disposed || ownRequest !== requestId) return;
        timestamps.set(url, restored.timestamp);
        publish(restored.definitions, {
          signedTimestamp: restored.timestamp,
          signingKey: restored.keys.keys[0],
        });
      })
      .catch(() => {
        // Invalid stored state must not prevent a fresh network attempt.
      });
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
      const restored = restoreCached(ownRequest);
      if (restored) await restored;
      if (disposed || ownRequest !== requestId) return;
      const fetcher: typeof fetch = (input, init) =>
        fetch(input, { ...init, cache: 'no-store', signal: controller.signal });
      const capture = captureEvaluatedResponse(fetcher);
      const requestKeys = jwks;
      const target = new URL(url);
      if (pin) target.searchParams.set('rev', pin);
      const result = await fetchEvaluatedSignedDefinitions(
        target.toString(),
        requestKeys,
        {
          ...options,
          baseURI,
          verifySignatures: true,
          // Own the verified cache: native HTTP caching must not add validators to forced invalidations.
          fetchImpl: capture.fetch,
        },
        { revision: unconditional ? null : revision },
      );
      if (disposed || ownRequest !== requestId) return;
      if (result.notModified) {
        if (!revision || unconditional)
          throw new Error('Unexpected 304 without a matching verified snapshot');
        return;
      }
      validateEvaluatedDefinitions(result.defs);
      const body = capture.body();
      if (!body) throw new Error('Missing signed envelope');
      const keys = await requestKeys.get({ ...options, baseURI, fetchImpl: fetcher });
      const verified = await verifyEnvelope(body, keys, options, timestamps.get(url) ?? 0);
      if (disposed || ownRequest !== requestId) return;
      timestamps.set(url, verified.timestamp);
      observedKeys.set(baseURI, structuredClone(keys));
      persistence.write(url, body, verified.keys);
      // HTTP confirms revisions only after verification. WS metadata never becomes a cache validator.
      revision = result.revision;
      publish(verified.definitions, {
        signedTimestamp: verified.timestamp,
        signingKey: verified.keys.keys[0],
      });
    } catch (cause) {
      if (!disposed && ownRequest === requestId) report(cause);
    } finally {
      clearTimeout(timeout);
      if (active === controller) {
        active = undefined;
        activeTimeout = undefined;
      }
    }
  };
  const invalidate = (pin?: string, rotate = false) => {
    if (disposed) return;
    if (rotate) {
      // Retire the instance: pending old key fetches cannot refill this epoch.
      jwks = new InMemoryJwksCache();
      observedKeys.delete(baseURI);
      persistence.invalidate();
    }
    // An old response must not publish during the debounce window after a newer invalidation.
    requestId++;
    active?.abort();
    if (activeTimeout) clearTimeout(activeTimeout);
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      void refresh(true, pin);
    }, 300);
  };
  const scheduleReconnect = () => {
    if (disposed) return;
    reconnect = setTimeout(
      () => {
        reconnect = undefined;
        connect();
      },
      Math.min(5000 * 2 ** attempts++, 60000),
    );
  };
  const connect = () => {
    if (disposed || options.enableLiveUpdates === false || typeof WebSocket === 'undefined') return;
    const target = new URL(`${baseURI.replace(/\/$/, '')}/${encodeURIComponent(appKey)}/ws`);
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    if (revision) target.searchParams.set('rev', revision);
    try {
      socket = new WebSocket(target);
      socket.onopen = () => {
        attempts = 0;
      };
      socket.onmessage = ({ data }) => {
        if (typeof data !== 'string') return;
        if (data === 'update' || data === 'flags-updated') {
          invalidate();
          return;
        }
        let message: { type?: string; etag?: string; unchanged?: boolean } | null;
        try {
          message = JSON.parse(data);
        } catch {
          return;
        }
        if (!message || typeof message !== 'object') return;
        const pin = typeof message.etag === 'string' ? message.etag : undefined;
        if (message.type === 'signing-key-updated') {
          invalidate(undefined, true);
          return;
        }
        if (message.type === 'sync' && message.unchanged === true) return;
        if (
          message.type === 'update' ||
          message.type === 'flags-updated' ||
          message.type === 'sync'
        ) {
          if (!pin || pin !== revision) invalidate(pin);
        }
      };
      socket.onclose = () => {
        socket = undefined;
        scheduleReconnect();
      };
      socket.onerror = () => {
        /* Browsers follow socket errors with close; polling remains the fallback. */
      };
    } catch (cause) {
      report(cause);
      scheduleReconnect();
    }
  };
  void refresh();
  connect();
  const interval = options.refreshInterval ?? 180000;
  const timer =
    interval > 0
      ? setInterval(() => {
          if (!active && !debounce) void refresh();
        }, interval)
      : undefined;
  return () => {
    disposed = true;
    requestId++;
    active?.abort();
    if (activeTimeout) clearTimeout(activeTimeout);
    if (timer) clearInterval(timer);
    if (reconnect) clearTimeout(reconnect);
    if (debounce) clearTimeout(debounce);
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  };
}
