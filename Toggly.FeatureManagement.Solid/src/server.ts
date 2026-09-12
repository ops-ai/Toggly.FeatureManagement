import { createTogglyClient, type TogglyClient, type EvaluationContext } from '@ops-ai/toggly-node-core';
import { buildEvaluatedSignedUrl, serializeJsonForInlineScript, type TogglyEntityContext, type TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import { InMemoryJwksCache, fetchEvaluatedSignedDefinitions, isEvaluatedDefinitions } from '@ops-ai/toggly-signed-defs';
import { publicContext, selectDefinitions, type TogglySnapshot } from './snapshot.js';
export { createTogglyClient };
export type { TogglyClient, EvaluationContext, TogglyServerConfig } from '@ops-ai/toggly-node-core';
export type { TogglySnapshot } from './snapshot.js';

export interface ServerRequestOptions {
  /** Initialized Node client. Its owner closes it on server shutdown. */
  client: TogglyClient;
  request: Request;
  /** Trusted server principal/context. Not copied to browser unless explicitly projected. */
  context?: EvaluationContext;
  clientContext?: TogglyEvaluationContext;
  frontend: {
    /** A frontend key, never the backend client's key. */
    appKey?: string;
    environment?: string;
    baseURI?: string;
    expose: readonly string[];
    flagDefaults?: Record<string, boolean>;
    allowedKeyIds?: string[];
    maxSignatureAgeSeconds?: number;
    timeout?: number;
    fetch?: typeof fetch;
    onError?: (cause: unknown) => void;
  };
}
export interface ServerGateOptions {
  requirement?: 'all' | 'any';
  negate?: boolean;
  entity?: TogglyEntityContext;
}

/** Create in a server query/action/API handler, once for its current Request. */
export function createTogglyRequest(options: ServerRequestOptions) {
  const context: EvaluationContext = structuredClone({ ...options.context, identity: options.context?.identity ?? '', request: {
    userAgent: options.request.headers.get('user-agent') ?? undefined,
    acceptLanguage: options.request.headers.get('accept-language') ?? undefined,
    ...options.context?.request,
  } });
  const projected = publicContext(options.clientContext);
  const { fetch: fetcher, onError, ...frontendConfig } = options.frontend;
  const frontend = { ...structuredClone(frontendConfig), fetch: fetcher, onError };
  if (frontend.appKey && frontend.appKey === options.client.config?.appKey) throw new Error('Use a distinct frontend application key');
  const controller = new AbortController();
  let disposed = false;
  let pending: Promise<TogglySnapshot> | undefined;
  const assertActive = () => { if (disposed || options.request.signal.aborted) throw new Error('Toggly request disposed'); };
  async function evaluate(keys: readonly string[], gate: ServerGateOptions = {}) {
    assertActive();
    const result = await options.client.evaluateFeatureGate([...keys], gate.requirement, gate.negate, context, gate.entity);
    assertActive();
    return result;
  }
  async function loadSnapshot(): Promise<TogglySnapshot> {
    const fallback: TogglySnapshot = { definitions: selectDefinitions(frontend.flagDefaults ?? {}, frontend.expose), context: projected, expose: [...frontend.expose], source: 'defaults' };
    if (!frontend.appKey) return fallback;
    // Snapshot transport is independent of the backend definition cache and key.
    try {
      const baseURI = frontend.baseURI ?? 'https://definitions.toggly.io';
      const url = buildEvaluatedSignedUrl(baseURI, encodeURIComponent(frontend.appKey), encodeURIComponent(frontend.environment ?? 'Production'), projected, false);
      const signal = AbortSignal.any([controller.signal, options.request.signal, AbortSignal.timeout(frontend.timeout ?? 10000)]);
      const result = await fetchEvaluatedSignedDefinitions(url, new InMemoryJwksCache(), {
        ...frontend, baseURI, verifySignatures: true,
        fetchImpl: (input, init) => (frontend.fetch ?? fetch)(input, { ...init, signal, cache: 'no-store' }),
      }, { headers: { 'User-Agent': context.request?.userAgent ?? '', 'Accept-Language': context.request?.acceptLanguage ?? '', 'X-Toggly-Sdk':'solidstart', 'X-Toggly-Sdk-Version':'0.2.0' } });
      assertActive();
      if (result.notModified || !isEvaluatedDefinitions(result.defs)) throw new Error('Invalid frontend snapshot response');
      return { ...fallback, definitions: selectDefinitions(result.defs, frontend.expose), source: 'signed' };
    } catch (cause) {
      assertActive();
      frontend.onError?.(cause);
      return fallback;
    }
  }
  return {
    async isEnabled(key: string, entity?: TogglyEntityContext) {
      assertActive();
      const result = await options.client.isFeatureOn(key, context, entity);
      assertActive();
      return result;
    },
    evaluate,
    async requireFeature(keys: string | readonly string[], gate?: ServerGateOptions): Promise<void> {
      if (!await evaluate(typeof keys === 'string' ? [keys] : keys, gate)) throw new Response('Feature unavailable', {status:404});
    },
    async snapshot(): Promise<TogglySnapshot> {
      assertActive();
      pending ??= loadSnapshot();
      const snapshot = await pending;
      assertActive();
      return structuredClone(snapshot);
    },
    dispose() { disposed = true; controller.abort(); },
  };
}
/** Use only for manual inline scripts; SolidStart queries use its native serializer. */
export function serializeSnapshot(snapshot: TogglySnapshot): string {
  return serializeJsonForInlineScript({ definitions: selectDefinitions(snapshot.definitions, snapshot.expose), context: publicContext(snapshot.context), expose: [...snapshot.expose], source: snapshot.source });
}
