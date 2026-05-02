/**
 * Origin fetch helpers.
 *
 * Centralises two concerns that all three origin call sites (manifest fetch,
 * static-asset proxy, HTML fetch) share:
 *
 *  1. Cloudflare Access service-token forwarding. When the origin is gated
 *     by Cloudflare Access (typical for `*.pages.dev` aliases on accounts
 *     that protect previews), the worker must include `CF-Access-Client-Id`
 *     and `CF-Access-Client-Secret` headers so its outbound request is
 *     accepted as a service-token-authenticated machine call. Without these,
 *     the worker would receive a 302 to the Access login page on every
 *     origin fetch and the user would see an empty document.
 *
 *  2. Redirect transparency. We follow redirects on origin so transient
 *     edge redirects (e.g. canonical-domain rewrites on the Pages side)
 *     don't bubble up to the client as opaque 30x responses.
 */
import type { Env } from './types';

/**
 * Build the headers used for every origin fetch, layering Cloudflare Access
 * service-token credentials on top of any caller-provided headers when the
 * worker is configured with them. Caller-provided values are preserved as-is
 * for everything else, so things like `If-None-Match` from the user's request
 * still flow through to origin.
 */
export function buildOriginHeaders(
  baseHeaders: HeadersInit | undefined,
  env: Env,
): Headers {
  const headers = new Headers(baseHeaders ?? undefined);
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID);
    headers.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
  }
  return headers;
}

/**
 * Fetch a URL on the origin, applying Access headers and following any
 * redirects (e.g. a Pages canonical-domain rewrite) so the worker always
 * returns a non-30x body to the rewriter / client.
 */
export async function fetchFromOrigin(
  url: string,
  init: RequestInit & { headers?: HeadersInit } = {},
  env: Env,
): Promise<Response> {
  const headers = buildOriginHeaders(init.headers, env);
  return fetch(url, {
    ...init,
    headers,
    redirect: 'follow',
  });
}
