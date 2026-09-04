import { AsyncLocalStorage } from 'node:async_hooks'
import type { FeatureCheckOptions } from './feature-check'

/**
 * Request-scoped ambient EvalContext for Next.js server helpers and RSC.
 * Never mutates the process-global client identity — bind overrides here only.
 */
const ambientStore = new AsyncLocalStorage<FeatureCheckOptions>()

function snapshot(ctx: FeatureCheckOptions): FeatureCheckOptions {
  return {
    ...(ctx.identity !== undefined ? { identity: ctx.identity } : {}),
    ...(ctx.groups !== undefined ? { groups: ctx.groups } : {}),
    ...(ctx.claims !== undefined ? { claims: ctx.claims } : {}),
    ...(ctx.request !== undefined ? { request: ctx.request } : {}),
    ...(ctx.headers !== undefined ? { headers: ctx.headers } : {}),
    ...(ctx.context !== undefined ? { context: ctx.context } : {}),
    ...(ctx.contextKind !== undefined ? { contextKind: ctx.contextKind } : {}),
  }
}

/**
 * Ambient FeatureCheckOptions for the current async context, if any.
 * Returns a shallow copy so callers cannot mutate the ALS store.
 */
export function getAmbientEvalOverrides(): FeatureCheckOptions | undefined {
  const store = ambientStore.getStore()
  return store ? snapshot(store) : undefined
}

/**
 * Run `fn` with the given EvalContext bound for the async scope.
 * Nested calls replace (do not deep-merge) the ambient store for their duration.
 */
export function runWithEvalContext<T>(
  ctx: FeatureCheckOptions,
  fn: () => T
): T {
  return ambientStore.run(snapshot(ctx), fn)
}

/**
 * Resolve a provider (sync or async), bind ambient EvalContext, then run `fn`.
 * Typical use: bind once in middleware / root server helper from request headers.
 */
export async function withEvalContext<T>(
  provider: () => FeatureCheckOptions | Promise<FeatureCheckOptions>,
  fn: () => T | Promise<T>
): Promise<T> {
  const ctx = await provider()
  return ambientStore.run(snapshot(ctx), () => fn())
}

/**
 * Merge ambient defaults with per-call options. Explicit per-call fields win
 * field-by-field; missing per-call fields keep ambient values.
 */
export function mergeFeatureCheckOptions(
  ambient: FeatureCheckOptions | undefined,
  perCall: FeatureCheckOptions
): FeatureCheckOptions {
  if (ambient == null) {
    return perCall
  }

  return {
    identity: perCall.identity ?? ambient.identity,
    groups: perCall.groups ?? ambient.groups,
    claims: perCall.claims ?? ambient.claims,
    request: perCall.request ?? ambient.request,
    headers: perCall.headers ?? ambient.headers,
    context: perCall.context ?? ambient.context,
    contextKind: perCall.contextKind ?? ambient.contextKind,
  }
}
