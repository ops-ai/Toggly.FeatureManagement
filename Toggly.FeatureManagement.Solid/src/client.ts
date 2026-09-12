import { captureEvaluatedResponse } from './transport.js';
import { selectDefinitions, publicContext, type TogglySnapshot } from './snapshot.js';
import { buildEvaluatedSignedUrl, evaluateResolvedKeys, resolveEvaluatedDefinition, type EvaluatedDefinitions, type TogglyEntityContext, type TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import { InMemoryJwksCache, fetchEvaluatedSignedDefinitions, isEvaluatedDefinitions, readAndParseEvaluatedResponseCached } from '@ops-ai/toggly-signed-defs';
import { applyLocalGate, buildFlagGateIndex, type LocalGate } from '@ops-ai/toggly-local-gates';

export type { TogglyEntityContext, TogglyEvaluationContext, EvaluatedDefinitions, LocalGate };
export interface TogglyOptions extends TogglyEvaluationContext {
  /** Restrict every browser snapshot to these public keys. */
  expose?: readonly string[];
  appKey?: string;
  environment?: string;
  baseURI?: string;
  flagDefaults?: Record<string, boolean>;
  verifySignatures?: boolean;
  allowedKeyIds?: string[];
  maxSignatureAgeSeconds?: number;
  fetch?: typeof fetch;
  connectTimeout?: number;
  refreshInterval?: number;
  enableLiveUpdates?: boolean;
  /** Opt-in envelope persistence. Storage is never accessed unless injected. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  localGates?: LocalGate[];
}
export interface ClientState {
  definitions: EvaluatedDefinitions;
  loading: boolean;
  error: Error | undefined;
}

/** One targeting session; create a distinct instance for each owner/request. */
export function createClient(options: TogglyOptions = {}, initialSnapshot?: TogglySnapshot) {
  const config = { ...options, baseURI: options.baseURI ?? 'https://definitions.toggly.io', environment: options.environment ?? 'Production', verifySignatures: options.verifySignatures ?? true };
  let expose = initialSnapshot ? [...initialSnapshot.expose] : options.expose;
  const initialContext = initialSnapshot?.context ?? options;
  let context: TogglyEvaluationContext = { identity: initialContext.identity, groups: [...(initialContext.groups ?? [])], claims: { ...initialContext.claims } };
  let state: ClientState = { definitions: selectDefinitions(initialSnapshot?.definitions ?? options.flagDefaults ?? {}, expose), loading: false, error: undefined };
  let gates = options.localGates ?? [];
  let gateIndex = buildFlagGateIndex(gates);
  const listeners = new Set<(state: ClientState) => void>();
  const jwks = new InMemoryJwksCache();
  let generation = 0;
  let disposed = false;
  let revision: string | null = null;
  let controller: AbortController | undefined;
  let socket: WebSocket | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let liveStarted = false;
  const emit = (next: Partial<ClientState>) => { state = { ...state, ...next }; listeners.forEach(listener => listener(state)); };
  const flags = () => ({ ...state.definitions });
  const headers = { 'X-Toggly-Sdk': 'solidjs', 'X-Toggly-Sdk-Version': '0.2.0' };

  const isCurrent = (current: number) => current === generation && !disposed;

  function restoreCached(cacheKey: string, fetchImpl: typeof fetch, current: number): Promise<void> | undefined {
    if (!config.storage || !config.verifySignatures) return;
    try {
      const cached = config.storage.getItem(cacheKey);
      if (!cached) return;
      return readAndParseEvaluatedResponseCached(new Response(cached), jwks, { ...config, fetchImpl }, headers)
        .then(defs => {
          if (isCurrent(current) && isEvaluatedDefinitions(defs)) {
            emit({ definitions: selectDefinitions(defs, expose) });
          }
        })
        .catch(() => { /* Invalid or expired cache must not prevent a network attempt. */ });
    } catch { /* Unavailable storage must not prevent a network attempt. */ }
  }

  function persistEnvelope(cacheKey: string, body: string | undefined) {
    if (!body || !config.verifySignatures) return;
    try { config.storage?.setItem(cacheKey, body); }
    catch { /* Storage quota must not prevent evaluation. */ }
  }

  async function fetchRemote(url: string, fetchImpl: typeof fetch, pin?: string | null) {
    const capture = captureEvaluatedResponse(fetchImpl);
    const requestURL = new URL(url);
    if (pin) requestURL.searchParams.set('rev', pin);
    const result = await fetchEvaluatedSignedDefinitions(requestURL.toString(), jwks,
      { ...config, fetchImpl: capture.fetch },
      { revision: pin === undefined ? revision : null, headers });
    return { result, body: capture.body() };
  }

  function acceptRemote(remote: Awaited<ReturnType<typeof fetchRemote>>, cacheKey: string, current: number) {
    if (!isCurrent(current)) return;
    const { result, body } = remote;
    if (!result.notModified) {
      // Complete validation precedes state, persistence and revision adoption.
      emit({ definitions: selectDefinitions(result.defs, expose) });
      persistEnvelope(cacheKey, body);
    }
    revision = result.revision ?? revision;
  }

  async function refresh(pin?: string | null): Promise<EvaluatedDefinitions> {
    if (disposed) return flags();
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    const controllerForRequest = controller;
    const timeout = setTimeout(() => controllerForRequest.abort(), config.connectTimeout ?? 10000);
    const fetchImpl: typeof fetch = (url, init) => (config.fetch ?? fetch)(url,
      { ...init, signal: controllerForRequest.signal, cache: 'no-store' });
    emit({ loading: true, error: undefined });
    try {
      if (!config.appKey) return flags();
      // The full URL scopes persisted envelopes by app, environment and targeting.
      const url = buildEvaluatedSignedUrl(config.baseURI, encodeURIComponent(config.appKey), encodeURIComponent(config.environment), context, false);
      const cacheKey = `toggly:solid:envelope:${url}`;
      const cached = restoreCached(cacheKey, fetchImpl, current);
      if (cached) await cached;
      acceptRemote(await fetchRemote(url, fetchImpl, pin), cacheKey, current);
    } catch (error) {
      if (isCurrent(current)) emit({ error: error instanceof Error ? error : new Error(String(error)) });
    } finally {
      clearTimeout(timeout);
      if (isCurrent(current)) emit({ loading: false });
    }
    return flags();
  }

  function startSocket() {
    if (disposed || !config.appKey || config.enableLiveUpdates === false || typeof WebSocket === 'undefined') return;
    const url = new URL(`${config.baseURI.replace(/\/$/, '')}/${encodeURIComponent(config.appKey)}/ws`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('sdk', 'solidjs');
    url.searchParams.set('sdkVersion', '0.2.0');
    if (revision) url.searchParams.set('rev', revision);
    try {
      socket = new WebSocket(url);
      socket.onmessage = event => {
        try {
          const data = String(event.data);
          const message = data === 'update' || data === 'flags-updated' ? { type: data } : JSON.parse(data);
          const changed = ['flags-updated', 'update'].includes(message.type) && (!message.etag || message.etag !== revision);
          const sync = message.type === 'sync' && message.unchanged !== true && (!revision || (message.etag && message.etag !== revision));
          if (message.type === 'signing-key-updated') jwks.clear();
          if (changed || sync || message.type === 'signing-key-updated') {
            clearTimeout(debounce);
            // null means a server invalidation without a pin: it must bypass the
            // prior conditional revision just as a revision-pinned fetch does.
            const pin = typeof message.etag === 'string' ? message.etag : null;
            debounce = setTimeout(() => { void refresh(pin); }, 300);
          }
        } catch { /* Ignore non-protocol messages. */ }
      };
      socket.onclose = () => { if (!disposed) reconnect = setTimeout(startSocket, 5000); };
    } catch { reconnect = setTimeout(startSocket, 5000); }
  }

  return {
    flags,
    /** Replace request-produced public state when a SolidStart route loader changes. */
    hydrate(snapshot: TogglySnapshot) {
      if (disposed) return;
      const definitions = selectDefinitions(snapshot.definitions, snapshot.expose);
      generation++; controller?.abort(); revision = null;
      expose = [...snapshot.expose]; context = publicContext(snapshot.context);
      emit({ definitions, loading: false, error: undefined });
    },
    state: () => state,
    context: () => structuredClone(context),
    refresh,
    /** Called by the browser provider on mount, never by module import. */
    start() {
      if (disposed || liveStarted) return;
      liveStarted = true;
      if ((config.refreshInterval ?? 180000) > 0 && config.appKey) poll = setInterval(() => { void refresh(); }, config.refreshInterval ?? 180000);
      startSocket();
    },
    subscribe(listener: (state: ClientState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    evaluate(keys: readonly string[], requirement: 'all' | 'any' = 'all', negate = false, entity?: TogglyEntityContext) {
      return evaluateResolvedKeys([...keys], requirement, negate, key => applyLocalGate(resolveEvaluatedDefinition(state.definitions[key], entity), key, gates, gateIndex));
    },
    async setContext(next: TogglyEvaluationContext) {
      if (disposed) return;
      context = { ...context, ...structuredClone(next) };
      // Never display the previous user's flags while a new user's request is pending.
      revision = null;
      emit({ definitions: selectDefinitions(config.flagDefaults ?? {}, expose), error: undefined });
      await refresh();
    },
    setLocalGates(next: LocalGate[]) { const index = buildFlagGateIndex(next); gates = next; gateIndex = index; emit({}); },
    notifyLocalGatesChanged() { emit({}); },
    dispose() {
      disposed = true;
      generation++;
      controller?.abort();
      clearInterval(poll); clearTimeout(reconnect); clearTimeout(debounce);
      if (socket) { socket.onmessage = null; socket.onclose = null; socket.close(); }
      listeners.clear();
    },
  };
}
export type TogglyClient = ReturnType<typeof createClient>;
