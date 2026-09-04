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
 * fields win field-by-field (including `undefined`); missing per-call keys
 * keep ambient values.
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

  const has = (key: keyof IdentityContext): boolean =>
    Object.prototype.hasOwnProperty.call(perCall, key);

  return {
    identity: has('identity') ? perCall.identity : ambient.identity,
    groups: has('groups') ? perCall.groups : ambient.groups,
    claims: has('claims') ? perCall.claims : ambient.claims,
    traits: has('traits') ? perCall.traits : ambient.traits,
    request: has('request') ? perCall.request : ambient.request,
  };
}
