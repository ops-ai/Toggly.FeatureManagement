import { createPersistence, verifyEnvelope } from './persistence.js';
import { captureEvaluatedResponse } from './transport.js';
import {
  selectDefinitions,
  publicContext,
  frontendDefinitionsUrl,
  definitionBaseURI,
  type TogglySnapshot,
} from './snapshot.js';
import {
  evaluateResolvedKeys,
  resolveEvaluatedDefinition,
  type EvaluatedDefinitions,
  type TogglyEntityContext,
  type TogglyEvaluationContext,
} from '@ops-ai/toggly-hooks-types';
import { InMemoryJwksCache, fetchEvaluatedSignedDefinitions } from '@ops-ai/toggly-signed-defs';
import { applyLocalGate, buildFlagGateIndex, type LocalGate } from '@ops-ai/toggly-local-gates';
import { createTelemetryReporter, type TelemetryOptions } from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';

export type { TogglyEntityContext, TogglyEvaluationContext, EvaluatedDefinitions, LocalGate };
export interface TogglyOptions extends TogglyEvaluationContext {
  /** Host-minted browser token; takes precedence over user targeting and telemetry. */
  instanceId?: string;
  /** Restrict every browser snapshot to these public keys. */
  expose?: readonly string[];
  /** Public frontend application key; never use a backend key in a browser. */
  appKey?: string;
  environment?: string;
  baseURI?: string;
  flagDefaults?: Record<string, boolean>;
  /** Verify ES256 signatures (default true). Disabling this also disables persistence. */
  verifySignatures?: boolean;
  /** Optional independent signing-key allowlist, applied to network and stored data. */
  allowedKeyIds?: string[];
  /** Maximum envelope age in seconds; unset/nonpositive disables age expiry. */
  maxSignatureAgeSeconds?: number;
  fetch?: typeof fetch;
  connectTimeout?: number;
  /** Polling interval in milliseconds (default 180000); zero disables polling. */
  refreshInterval?: number;
  /** Enable reconnecting WebSocket invalidations (default true). */
  enableLiveUpdates?: boolean;
  /**
   * Opt-in origin/application-owned storage for signed envelopes and verified
   * public keys. Reads are reverified; keys include public targeting data.
   */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  localGates?: LocalGate[];
  enableTelemetry?: boolean;
  metricsBaseUrl?: string;
  telemetryFlushIntervalMs?: number;
  telemetryFetch?: TelemetryOptions['fetch'];
  onTelemetryDiagnostic?: TelemetryOptions['onDiagnostic'];
}
export interface ClientState {
  definitions: EvaluatedDefinitions;
  loading: boolean;
  error: Error | undefined;
}

/** One targeting session; create a distinct instance for each owner/request. */
export function createClient(options: TogglyOptions = {}, initialSnapshot?: TogglySnapshot) {
  const config = {
    ...options,
    baseURI: options.baseURI ?? 'https://definitions.toggly.io',
    environment: options.environment ?? 'Production',
    verifySignatures: options.verifySignatures ?? true,
  };
  let expose = initialSnapshot ? [...initialSnapshot.expose] : options.expose;
  const acceptsSnapshot = (snapshot: TogglySnapshot, token?: string) =>
    !token?.trim() || snapshot.context.instanceId?.trim() === token.trim();
  const acceptedSnapshot =
    initialSnapshot && acceptsSnapshot(initialSnapshot, options.instanceId?.trim())
      ? initialSnapshot
      : undefined;
  const initialContext = acceptedSnapshot?.context ?? options;
  let context: TogglyEvaluationContext & { instanceId?: string } = {
    instanceId: initialContext.instanceId?.trim() || undefined,
    identity: initialContext.identity,
    groups: [...(initialContext.groups ?? [])],
    claims: { ...initialContext.claims },
  };
  let state: ClientState = {
    definitions: selectDefinitions(
      acceptedSnapshot?.definitions ?? options.flagDefaults ?? {},
      expose,
    ),
    loading: false,
    error: undefined,
  };
  // Signed SSR and accepted cache/network values are authoritative for this context.
  let hasAcceptedState = acceptedSnapshot?.source === 'signed';
  let gates = options.localGates ?? [];
  let gateIndex = buildFlagGateIndex(gates);
  const listeners = new Set<(state: ClientState) => void>();
  let jwks = new InMemoryJwksCache();
  const persistence = createPersistence(config.storage, config.baseURI);
  const timestamps = new Map<string, number>();
  let generation = 0;
  let disposed = false;
  let revision: string | null = null;
  let controller: AbortController | undefined;
  let socket: WebSocket | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let liveStarted = false;
  const requestTimeouts = new Set<ReturnType<typeof setTimeout>>();
  const reporter =
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    options.appKey?.trim() &&
    options.enableTelemetry !== false
      ? createTelemetryReporter({
          appKey: options.appKey,
          environment: options.environment,
          instanceId: context.instanceId,
          identity: context.identity,
          metricsBaseUrl: options.metricsBaseUrl,
          telemetryFlushIntervalMs: options.telemetryFlushIntervalMs,
          fetch: options.telemetryFetch,
          onDiagnostic: options.onTelemetryDiagnostic,
        })
      : undefined;
  const detachTelemetry = reporter ? attachBrowserLifecycle(reporter) : undefined;
  const emit = (next: Partial<ClientState>) => {
    state = { ...state, ...next };
    const published = state;
    const current = generation;
    for (const listener of listeners) {
      if (!isCurrent(current)) break;
      try {
        void Promise.resolve(listener(published)).catch(() => {});
      } catch {
        /* A host observer cannot interrupt publication to other observers. */
      }
    }
  };
  const flags = () => ({ ...state.definitions });
  const headers = { 'X-Toggly-Sdk': 'solidjs', 'X-Toggly-Sdk-Version': '0.3.0' };

  const isCurrent = (current: number) => current === generation && !disposed;

  function restoreCached(scope: string, current: number): Promise<void> | undefined {
    if (!config.verifySignatures || hasAcceptedState) return;
    return persistence
      .read(scope, config, timestamps.get(scope) ?? 0)
      ?.then((verified) => {
        if (!isCurrent(current)) return;
        timestamps.set(scope, verified.timestamp);
        const definitions = selectDefinitions(verified.definitions, expose);
        hasAcceptedState = true;
        emit({ definitions });
      })
      .catch(() => {
        /* Invalid or expired storage cannot block network recovery. */
      });
  }

  async function fetchRemote(url: string, fetchImpl: typeof fetch, pin?: string | null) {
    const capture = captureEvaluatedResponse(fetchImpl);
    const requestURL = new URL(url);
    if (pin) requestURL.searchParams.set('rev', pin);
    const result = await fetchEvaluatedSignedDefinitions(
      requestURL.toString(),
      jwks,
      { ...config, baseURI: definitionBaseURI(config.baseURI), fetchImpl: capture.fetch },
      { revision: pin === undefined ? revision : null, headers },
    );
    return { result, body: capture.body() };
  }

  async function acceptRemote(
    remote: Awaited<ReturnType<typeof fetchRemote>>,
    scope: string,
    current: number,
    fetchImpl: typeof fetch,
  ) {
    if (!isCurrent(current)) return;
    const { result, body } = remote;
    if (!result.notModified) {
      let definitions = result.defs;
      if (config.verifySignatures) {
        if (!body) throw new Error('Missing signed envelope');
        const keys = await jwks.get({
          ...config,
          baseURI: definitionBaseURI(config.baseURI),
          fetchImpl,
        });
        const verified = await verifyEnvelope(body, keys, config, timestamps.get(scope) ?? 0);
        if (!isCurrent(current)) return;
        definitions = verified.definitions;
        timestamps.set(scope, verified.timestamp);
        persistence.write(scope, body, verified.keys);
      }
      // Complete validation and storage callbacks precede atomic body/revision adoption.
      const projected = selectDefinitions(definitions, expose);
      if (!isCurrent(current)) return;
      hasAcceptedState = true;
      revision = result.revision ?? null;
      emit({ definitions: projected });
    } else {
      if (!hasAcceptedState)
        throw new Error('304 Not Modified without matching accepted definitions');
      revision = result.revision ?? revision;
    }
  }

  async function refresh(pin?: string | null): Promise<EvaluatedDefinitions> {
    if (disposed) return flags();
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    const controllerForRequest = controller;
    const timeout = setTimeout(() => controllerForRequest.abort(), config.connectTimeout ?? 10000);
    requestTimeouts.add(timeout);
    const fetchImpl: typeof fetch = (url, init) =>
      (config.fetch ?? fetch)(url, {
        ...init,
        signal: controllerForRequest.signal,
        cache: 'no-store',
      });
    emit({ loading: true, error: undefined });
    try {
      if (!config.appKey || !isCurrent(current)) return flags();
      // The full URL scopes persisted envelopes by app, environment and targeting.
      const url = frontendDefinitionsUrl(
        config.baseURI,
        config.appKey,
        config.environment,
        context,
      );
      const cached = restoreCached(url, current);
      if (cached) await cached;
      if (!isCurrent(current)) return flags();
      await acceptRemote(await fetchRemote(url, fetchImpl, pin), url, current, fetchImpl);
    } catch (error) {
      if (isCurrent(current))
        emit({ error: error instanceof Error ? error : new Error(String(error)) });
    } finally {
      clearTimeout(timeout);
      requestTimeouts.delete(timeout);
      if (isCurrent(current)) emit({ loading: false });
    }
    return flags();
  }

  function startSocket() {
    if (
      disposed ||
      !config.appKey ||
      config.enableLiveUpdates === false ||
      typeof WebSocket === 'undefined'
    )
      return;
    const url = new URL(
      `${config.baseURI.replace(/\/$/, '')}/${encodeURIComponent(config.appKey)}/ws`,
    );
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('sdk', 'solidjs');
    url.searchParams.set('sdkVersion', '0.3.0');
    if (revision) url.searchParams.set('rev', revision);
    try {
      socket = new WebSocket(url);
      const ownedSocket = socket;
      socket.onmessage = (event) => {
        if (disposed || socket !== ownedSocket) return;
        try {
          const data = String(event.data);
          const message =
            data === 'update' || data === 'flags-updated' ? { type: data } : JSON.parse(data);
          const changed =
            ['flags-updated', 'update'].includes(message.type) &&
            (!message.etag || message.etag !== revision);
          const sync =
            message.type === 'sync' &&
            message.unchanged !== true &&
            (!revision || (message.etag && message.etag !== revision));
          if (message.type === 'signing-key-updated') {
            // Old in-flight key fetches may complete after invalidation. Retire
            // the entire cache instance so they cannot refill the new epoch.
            jwks = new InMemoryJwksCache();
            persistence.invalidate();
          }
          if (changed || sync || message.type === 'signing-key-updated') {
            // Invalidation retires pending work before the debounce window.
            generation++;
            controller?.abort();
            clearTimeout(debounce);
            // null means a server invalidation without a pin: it must bypass the
            // prior conditional revision just as a revision-pinned fetch does.
            const pin = typeof message.etag === 'string' ? message.etag : null;
            debounce = setTimeout(() => {
              void refresh(pin);
            }, 300);
          }
        } catch {
          /* Ignore non-protocol messages. */
        }
      };
      socket.onclose = () => {
        if (!disposed && socket === ownedSocket) {
          socket = undefined;
          reconnect = setTimeout(startSocket, 5000);
        }
      };
    } catch {
      reconnect = setTimeout(startSocket, 5000);
    }
  }

  function stopSocket() {
    clearTimeout(reconnect);
    clearTimeout(debounce);
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
      socket = undefined;
    }
  }

  return {
    flags,
    recordUsage(key: string, variant = 'enabled') {
      reporter?.recordUsage(key, variant);
    },
    recordView(key: string, variant = 'enabled') {
      reporter?.recordView(key, variant);
    },
    incrementCounter(key: string, value = 1) {
      reporter?.incrementCounter(key, value);
    },
    setGauge(key: string, value: number) {
      reporter?.setGauge(key, value);
    },
    async flushTelemetry(): Promise<void> {
      await reporter?.flush();
    },
    /** Replace request-produced public state when a SolidStart route loader changes. */
    hydrate(snapshot: TogglySnapshot) {
      if (disposed || !acceptsSnapshot(snapshot, context.instanceId)) return;
      const definitions = selectDefinitions(snapshot.definitions, snapshot.expose);
      generation++;
      controller?.abort();
      revision = null;
      stopSocket();
      const current = generation;
      expose = [...snapshot.expose];
      context = publicContext(snapshot.context);
      reporter?.setContext({ instanceId: context.instanceId, identity: context.identity });
      hasAcceptedState = snapshot.source === 'signed';
      emit({ definitions, loading: false, error: undefined });
      if (isCurrent(current) && liveStarted) startSocket();
    },
    state: () => state,
    context: () => structuredClone(context),
    refresh,
    /** Called by the browser provider on mount, never by module import. */
    start() {
      if (disposed || liveStarted || typeof window === 'undefined') return;
      liveStarted = true;
      if ((config.refreshInterval ?? 180000) > 0 && config.appKey)
        poll = setInterval(() => {
          void refresh();
        }, config.refreshInterval ?? 180000);
      startSocket();
    },
    subscribe(listener: (state: ClientState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    evaluate(
      keys: readonly string[],
      requirement: 'all' | 'any' = 'all',
      negate = false,
      entity?: TogglyEntityContext,
    ) {
      const definitions = selectDefinitions(state.definitions, keys);
      const capturedGates = gates.map((gate) => ({ ...gate, flagKeys: [...gate.flagKeys] }));
      const capturedIndex = gateIndex;
      const check = reporter?.captureCheck();
      return evaluateResolvedKeys([...keys], requirement, negate, (key) => {
        const enabled = applyLocalGate(
          resolveEvaluatedDefinition(definitions[key], entity),
          key,
          capturedGates,
          capturedIndex,
        );
        check?.(key, enabled ? 'enabled' : 'disabled');
        return enabled;
      });
    },
    async setContext(next: TogglyEvaluationContext & { instanceId?: string }) {
      if (disposed) return;
      generation++;
      controller?.abort();
      context = { ...context, ...structuredClone(next) };
      if (Object.hasOwn(next, 'identity') && !Object.hasOwn(next, 'instanceId'))
        context.instanceId = undefined;
      context.instanceId = context.instanceId?.trim() || undefined;
      stopSocket();
      const installed = context;
      reporter?.setContext({ instanceId: context.instanceId, identity: context.identity });
      const current = generation;
      // The new context may restore its own cache, but never reuse prior-user state.
      hasAcceptedState = false;
      // Never display the previous user's flags while a new user's request is pending.
      revision = null;
      emit({ definitions: selectDefinitions(config.flagDefaults ?? {}, expose), error: undefined });
      if (isCurrent(current)) await refresh();
      if (!disposed && context === installed && liveStarted) startSocket();
    },
    setLocalGates(next: LocalGate[]) {
      const index = buildFlagGateIndex(next);
      gates = next;
      gateIndex = index;
      emit({ definitions: { ...state.definitions } });
    },
    notifyLocalGatesChanged() {
      emit({ definitions: { ...state.definitions } });
    },
    dispose() {
      disposed = true;
      generation++;
      controller?.abort();
      requestTimeouts.forEach(clearTimeout);
      requestTimeouts.clear();
      clearInterval(poll);
      stopSocket();
      listeners.clear();
      detachTelemetry?.();
      reporter?.dispose();
    },
  };
}
export type TogglyClient = ReturnType<typeof createClient>;
