import { error, type Handle, type RequestEvent } from '@sveltejs/kit';
import type { TogglyClient, EvaluationContext } from '@ops-ai/toggly-node-core';
import { buildEvaluatedSignedUrl } from '@ops-ai/toggly-hooks-types';
import { selectDefinitions, type GateOptions, type TogglySnapshot, type TogglyEvaluationContext } from './types.js';
import { verifyEnvelope } from './persistence.js';
import { captureEvaluatedResponse } from './transport.js';
import { InMemoryJwksCache, fetchEvaluatedSignedDefinitions } from '@ops-ai/toggly-signed-defs';
export { createTogglyClient } from '@ops-ai/toggly-node-core';
export type { TogglyClient, TogglyServerConfig, EvaluationContext } from '@ops-ai/toggly-node-core';

export interface ServerOptions {
  /** Initialized Node client; reuse across requests, close on process shutdown. */
  client: TogglyClient;
  context?: (event: RequestEvent) => EvaluationContext | Promise<EvaluationContext>;
  /** Explicit public context projection; defaults to no identity/claims. */
  clientContext?: (event: RequestEvent, context: Readonly<EvaluationContext>) => TogglyEvaluationContext;
  frontend: {
    appKey?: string;
    environment?: string;
    baseURI?: string;
    expose: string[];
    featureDefaults?: Record<string, boolean>;
    allowedKeyIds?: string[];
    maxSignatureAgeSeconds?: number;
    timeout?: number;
    onError?: (error: unknown) => void;
  };
}
export interface RequestToggly {
  isEnabled(key: string, options?: Pick<GateOptions, 'entity'>): Promise<boolean>;
  gate(keys: string[], options?: Omit<GateOptions, 'defaultValue'>): Promise<boolean>;
  snapshot(): Promise<TogglySnapshot>;
}
declare global { namespace App { interface Locals { toggly: RequestToggly; } } }

export function createTogglyHandle(options: ServerOptions): Handle {
  const frontend = structuredClone({ ...options.frontend, onError: undefined });
  return async ({ event, resolve }) => {
    const supplied = await options.context?.(event);
    const context: EvaluationContext = structuredClone({ ...supplied, request: {
      userAgent: event.request.headers.get('user-agent') ?? undefined,
      acceptLanguage: event.request.headers.get('accept-language') ?? undefined,
      country: event.request.headers.get('cf-ipcountry') ?? undefined,
      ...supplied?.request,
    } });
    const publicContext = structuredClone(options.clientContext?.(event, structuredClone(context)) ?? {});
    let pending: Promise<TogglySnapshot> | undefined;
    const snapshot = async (): Promise<TogglySnapshot> => {
      const definitions = selectDefinitions(frontend.featureDefaults ?? {}, frontend.expose);
      if (!frontend.appKey) return { definitions, context: publicContext, expose: [...frontend.expose], source: 'defaults' };
      try {
        const baseURI = frontend.baseURI ?? 'https://definitions.toggly.io';
        const url = buildEvaluatedSignedUrl(baseURI, frontend.appKey, frontend.environment ?? 'Production', publicContext, false);
        const fetchImpl: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(frontend.timeout ?? 5000) });
        const capture = captureEvaluatedResponse(fetchImpl);
        const keys = new InMemoryJwksCache();
        const result = await fetchEvaluatedSignedDefinitions(url, keys, {
          ...frontend, baseURI, verifySignatures: true, fetchImpl: capture.fetch,
        }, { headers: {
          'User-Agent': context.request!.userAgent ?? '',
          'Accept-Language': context.request!.acceptLanguage ?? '',
          'cf-ipcountry': context.request!.country ?? '',
        } });
        if (result.notModified) throw new Error('Unexpected 304 without a verified request snapshot');
        const body = capture.body();
        if (!body) throw new Error('Missing signed envelope');
        const verified = await verifyEnvelope(body, await keys.get({ ...frontend, baseURI, fetchImpl }), frontend);
        return {
          definitions: selectDefinitions(verified.definitions, frontend.expose),
          context: publicContext,
          expose: [...frontend.expose],
          source: 'signed',
          signedTimestamp: verified.timestamp,
          signingKey: verified.keys.keys[0],
        };
      } catch (cause) {
        // Reporting must not turn a safe default snapshot into a failed request.
        try {
          void Promise.resolve(options.frontend.onError?.(cause)).catch(() => {
            // A rejected observer cannot invalidate the fallback snapshot.
          });
        } catch {
          // Synchronous observers are isolated from request handling too.
        }
        return { definitions, context: publicContext, expose: [...frontend.expose], source: 'defaults' };
      }
    };
    event.locals.toggly = {
      isEnabled: (key, gate = {}) => options.client.isFeatureOn(key, context, gate.entity),
      gate: (keys, gate = {}) => options.client.evaluateFeatureGate(keys, gate.requirement, gate.negate, context, gate.entity),
      snapshot: () => { pending ??= snapshot(); return pending.then(value => structuredClone(value)); },
    };
    return resolve(event);
  };
}
function scoped(event: RequestEvent): RequestToggly {
  if (!event.locals.toggly) throw new Error('Install createTogglyHandle in hooks.server.ts before using Toggly helpers');
  return event.locals.toggly;
}
/** Return only this snapshot from +layout.server.ts; never serialize the Node client. */
export function loadToggly(event: RequestEvent): Promise<TogglySnapshot> { return scoped(event).snapshot(); }
/** Server load/action guard. Feature gating supplements your existing authentication/authorization. */
export async function requireFeature(event: RequestEvent, keys: string | string[], options: Omit<GateOptions, 'defaultValue'> = {}): Promise<void> {
  if (!await scoped(event).gate(typeof keys === 'string' ? [keys] : keys, options)) error(404, 'Feature unavailable');
}
