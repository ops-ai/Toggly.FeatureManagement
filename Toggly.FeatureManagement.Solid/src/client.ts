import { buildEvaluatedSignedUrl, evaluateResolvedKeys, resolveEvaluatedDefinition, type EvaluatedDefinitions, type TogglyEntityContext, type TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import { InMemoryJwksCache, fetchEvaluatedSignedDefinitions, isEvaluatedDefinitions, readAndParseEvaluatedResponseCached } from '@ops-ai/toggly-signed-defs';
import { applyLocalGate, buildFlagGateIndex, type LocalGate } from '@ops-ai/toggly-local-gates';

export type { TogglyEntityContext, TogglyEvaluationContext, EvaluatedDefinitions, LocalGate };
export interface TogglyOptions extends TogglyEvaluationContext {
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
export function createClient(options: TogglyOptions = {}) {
  const config = { ...options, baseURI: options.baseURI ?? 'https://definitions.toggly.io', environment: options.environment ?? 'Production', verifySignatures: options.verifySignatures ?? true };
  let context: TogglyEvaluationContext = { identity: options.identity, groups: [...(options.groups ?? [])], claims: { ...options.claims } };
  let state: ClientState = { definitions: { ...options.flagDefaults }, loading: false, error: undefined };
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
  const headers = { 'X-Toggly-Sdk': 'solidjs', 'X-Toggly-Sdk-Version': '0.1.0' };

  async function refresh(pin?: string): Promise<EvaluatedDefinitions> {
    if (disposed) return flags();
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const timeout = setTimeout(() => controllerForRequest.abort(), config.connectTimeout ?? 10000);
    const controllerForRequest = controller;
    const fetchImpl: typeof fetch = (url, init) => (config.fetch ?? fetch)(url, { ...init, signal });
    const parseConfig = { ...config, fetchImpl };
    emit({ loading: true, error: undefined });
    try {
      if (!config.appKey) return flags();
      // The canonical full request URL scopes cache entries by application, environment
      // and targeting, avoiding delimiter collisions in user-provided identities.
      const url = buildEvaluatedSignedUrl(config.baseURI, encodeURIComponent(config.appKey), encodeURIComponent(config.environment), context, false);
      const cacheKey = `toggly:solid:envelope:${url}`;
      if (config.storage && config.verifySignatures) {
        try {
          const cached = config.storage.getItem(cacheKey);
          if (cached) {
            const defs = await readAndParseEvaluatedResponseCached(new Response(cached), jwks, parseConfig, headers);
            if (current === generation && !disposed && isEvaluatedDefinitions(defs)) emit({ definitions: defs });
          }
        } catch { /* Invalid, expired or unavailable cache is never trusted. Try network. */ }
      }
      let body: string | undefined;
      const captureFetch: typeof fetch = async (input, init) => {
        const response = await fetchImpl(input, init);
        if (String(input).includes('/evaluated-signed/') && response.ok) body = await response.clone().text();
        return response;
      };
      const requestURL = new URL(url);
      if (pin) requestURL.searchParams.set('rev', pin);
      const result = await fetchEvaluatedSignedDefinitions(requestURL.toString(), jwks, { ...parseConfig, fetchImpl: captureFetch }, { revision: pin ? null : revision, headers });
      if (current !== generation || disposed) return flags();
      if (!result.notModified) {
        if (!isEvaluatedDefinitions(result.defs)) throw new Error('Invalid evaluated definitions');
        emit({ definitions: result.defs });
        if (body && config.verifySignatures) {
          try { config.storage?.setItem(cacheKey, body); } catch { /* Storage quota must not prevent evaluation. */ }
        }
      }
      revision = result.revision ?? revision;
    } catch (error) {
      if (current === generation && !disposed) emit({ error: error instanceof Error ? error : new Error(String(error)) });
    } finally {
      clearTimeout(timeout);
      if (current === generation && !disposed) emit({ loading: false });
    }
    return flags();
  }

  function startSocket() {
    if (disposed || !config.appKey || config.enableLiveUpdates === false || typeof WebSocket === 'undefined') return;
    const url = new URL(`${config.baseURI.replace(/\/$/, '')}/${encodeURIComponent(config.appKey)}/ws`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('sdk', 'solidjs');
    url.searchParams.set('sdkVersion', '0.1.0');
    if (revision) url.searchParams.set('rev', revision);
    try {
      socket = new WebSocket(url);
      socket.onmessage = event => {
        try {
          const message = JSON.parse(String(event.data));
          const changed = ['flags-updated', 'update'].includes(message.type) && (!message.etag || message.etag !== revision);
          const sync = message.type === 'sync' && message.unchanged !== true && (!revision || (message.etag && message.etag !== revision));
          if (message.type === 'signing-key-updated') jwks.clear();
          if (changed || sync || message.type === 'signing-key-updated') {
            clearTimeout(debounce);
            debounce = setTimeout(() => { void refresh(message.etag); }, 300);
          }
        } catch { /* Ignore non-protocol messages. */ }
      };
      socket.onclose = () => { if (!disposed) reconnect = setTimeout(startSocket, 5000); };
    } catch { reconnect = setTimeout(startSocket, 5000); }
  }

  return {
    flags,
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
      emit({ definitions: { ...config.flagDefaults }, error: undefined });
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
