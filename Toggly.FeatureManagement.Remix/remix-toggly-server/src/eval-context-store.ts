/**
 * Request-scoped ambient EvalContext for Remix loaders and actions.
 * Never mutates the process-global client identity — bind overrides here only.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { IdentityContext } from '@ops-ai/remix-toggly-core';

const ambientStore = new AsyncLocalStorage<IdentityContext>();

function snapshot(ctx: IdentityContext): IdentityContext {
  return {
    ...(ctx.identity !== undefined ? { identity: ctx.identity } : {}),
    ...(ctx.groups !== undefined ? { groups: ctx.groups } : {}),
    ...(ctx.claims !== undefined ? { claims: ctx.claims } : {}),
    ...(ctx.traits !== undefined ? { traits: ctx.traits } : {}),
    ...(ctx.request !== undefined ? { request: ctx.request } : {}),
  };
}

/**
 * Ambient IdentityContext for the current async scope, if any.
 * Returns a shallow copy so callers cannot mutate the ALS store.
 */
export function getAmbientEvalOverrides(): IdentityContext | undefined {
  const store = ambientStore.getStore();
  return store ? snapshot(store) : undefined;
}

/**
 * Run `fn` with the given EvalContext bound for the async scope.
 * Nested calls replace (do not deep-merge) the ambient store for their duration.
 */
export function runWithEvalContext<T>(
  ctx: IdentityContext,
  fn: () => T,
): T {
  return ambientStore.run(snapshot(ctx), fn);
}

/**
 * Merge ambient defaults with per-call IdentityContext. Explicit per-call
 * fields win field-by-field; a field counts as "set" only when its value is
 * not `undefined` (a key present with an `undefined` value — e.g. from
 * `{ claims: user.claims }` where `user.claims` is optional — falls back to
 * ambient, same as an omitted key). Missing per-call keys keep ambient values.
 */
export function mergeIdentityContext(
  ambient: IdentityContext | undefined,
  perCall: IdentityContext | undefined,
): IdentityContext | undefined {
  if (ambient == null && perCall == null) {
    return undefined;
  }
  if (ambient == null) {
    return perCall ? snapshot(perCall) : undefined;
  }
  if (perCall == null) {
    return snapshot(ambient);
  }

  return {
    identity: perCall.identity !== undefined ? perCall.identity : ambient.identity,
    groups: perCall.groups !== undefined ? perCall.groups : ambient.groups,
    claims: perCall.claims !== undefined ? perCall.claims : ambient.claims,
    traits: perCall.traits !== undefined ? perCall.traits : ambient.traits,
    request: perCall.request !== undefined ? perCall.request : ambient.request,
  };
}
