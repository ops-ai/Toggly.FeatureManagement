/**
 * Toggly Docusaurus Edge Middleware (Cloudflare Pages Functions).
 *
 * Drop-in `_middleware.ts` for any Docusaurus site deployed on Cloudflare Pages
 * that uses `@ops-ai/toggly-docusaurus-plugin`. Runs in front of every request
 * and:
 *
 *   1. Reads the page-feature manifest emitted by the Docusaurus plugin
 *      (`/toggly-page-features.json`) from the same Pages deployment via the
 *      `ASSETS` binding. No cross-origin fetch — the manifest is part of the
 *      static build this middleware fronts, so there is no Pages-vs-Worker
 *      domain dance and no Cloudflare Access service-token to manage.
 *   2. Fetches the live flag map from Toggly's definitions API using
 *      `@ops-ai/toggly-client-core`, edge-cached for `FLAGS_CACHE_TTL_SECONDS`
 *      via `caches.default`.
 *   3. If the requested path is mapped to a feature flag and that flag is OFF,
 *      returns 404 (or a configurable redirect). Otherwise lets the static
 *      asset flow through and runs the HTML response through `HTMLRewriter` to:
 *        - strip `[data-feature]` elements whose flag is off, and
 *        - prepend a `window.__TOGGLY_EDGE_FLAGS__` snapshot to `<head>` so the
 *          Docusaurus client SDK hydrates against the same view the edge
 *          served (no React 18 hydration mismatch / re-render flash).
 *
 * This is the Pages-Functions counterpart to the standalone Cloudflare Worker
 * in `cloudflare/worker/`. They are deliberately independent files: Pages
 * Functions read static assets via the `ASSETS` binding and never need an
 * external origin URL or Access service-token, so a single self-contained
 * file (with only `@ops-ai/toggly-client-core` as a runtime dep) is the least
 * surprising integration shape for users who already host on Pages.
 *
 * Required env vars (set in the Pages project's "Environment variables"):
 *   - TOGGLY_API_BASE_URL   e.g. https://definitions.toggly.io
 *   - TOGGLY_ENVIRONMENT    e.g. Production
 *   - TOGGLY_APP_KEY        Frontend app key from Toggly (mark as a Secret)
 *
 * Optional env vars:
 *   - TOGGLY_PAGE_GATE_BEHAVIOR   '404' (default) or 'redirect'
 *   - TOGGLY_REDIRECT_URL         Path to redirect to when behavior=redirect
 *
 * No npm runtime dependencies. The flag fetch against Toggly's
 * `evaluated-signed` endpoint is short enough to inline (~30 lines) and
 * keeping it that way means the only thing users have to do is copy this
 * single file into their Pages project's `functions/` folder.
 */

interface Env {
  /**
   * Pages-provided binding for the static asset bundle. Cloudflare injects
   * this automatically for every Pages project; no wrangler config required.
   */
  ASSETS: { fetch: (request: Request) => Promise<Response> };

  TOGGLY_API_BASE_URL: string;
  TOGGLY_ENVIRONMENT: string;
  TOGGLY_APP_KEY: string;

  TOGGLY_PAGE_GATE_BEHAVIOR?: '404' | 'redirect';
  TOGGLY_REDIRECT_URL?: string;
}

type PageFeatureMapping = Record<string, string>;
type Flags = Record<string, boolean>;

/**
 * Shape of the `evaluated-signed` endpoint response. The API has historically
 * returned either a bare flag map or `{ defs: <flag map> }`; we accept both.
 */
interface TogglyApiPayload {
  defs?: Flags;
  [key: string]: unknown;
}

const FLAGS_CACHE_TTL_SECONDS = 30;
const FLAGS_FETCH_TIMEOUT_MS = 5_000;
const MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;

const SNAPSHOT_GLOBAL = '__TOGGLY_EDGE_FLAGS__';
const MANIFEST_PATH = '/toggly-page-features.json';

/**
 * Path prefixes that are guaranteed not to be HTML pages. Skipping the
 * manifest + flag lookup for these saves edge CPU and avoids touching
 * `caches.default` on every JS/CSS/image hit.
 */
const ASSET_PATH_PREFIXES = [
  '/assets/',
  '/img/',
  '/static/',
  '/_next/',
];

let manifestCache: PageFeatureMapping | null = null;
let manifestCacheTimestamp = 0;

/**
 * Fetch and cache the page-feature manifest from the Pages static asset store.
 * In-memory cache is per-isolate; `MANIFEST_CACHE_TTL_MS` bounds how stale a
 * single isolate's view can be.
 */
async function loadManifest(env: Env): Promise<PageFeatureMapping> {
  const now = Date.now();
  if (manifestCache && now - manifestCacheTimestamp < MANIFEST_CACHE_TTL_MS) {
    return manifestCache;
  }

  // Synthetic URL is fine; ASSETS only inspects the pathname.
  const manifestRequest = new Request(
    new URL(MANIFEST_PATH, 'https://internal/').toString(),
    { method: 'GET', headers: { Accept: 'application/json' } },
  );
  const response = await env.ASSETS.fetch(manifestRequest);
  if (!response.ok) {
    return {};
  }

  const manifest = (await response.json()) as PageFeatureMapping;
  manifestCache = manifest;
  manifestCacheTimestamp = now;
  return manifest;
}

/**
 * Look up the feature key gating `path` in the manifest. Tries the path as-is
 * and with/without a trailing slash, because Docusaurus's normalisation may
 * write either form depending on `trailingSlash` config.
 */
function getFeatureKeyForPath(
  path: string,
  manifest: PageFeatureMapping,
): string | null {
  if (manifest[path]) return manifest[path];

  const withSlash = path.endsWith('/') ? path : `${path}/`;
  if (manifest[withSlash]) return manifest[withSlash];

  const withoutSlash =
    path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
  if (manifest[withoutSlash]) return manifest[withoutSlash];

  return null;
}

/**
 * Fetch flags from Toggly's `evaluated-signed` endpoint with a hard timeout.
 * Returns an empty map on any error so the caller can fail open (the section
 * rewriter just won't strip anything; the page gate won't trigger). Edge
 * caching wraps this call in `loadFlags`.
 */
async function fetchFlagsFromTogglyApi(env: Env): Promise<Flags> {
  if (!env.TOGGLY_APP_KEY) {
    return {};
  }

  const baseUrl = env.TOGGLY_API_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/${env.TOGGLY_APP_KEY}/evaluated-signed`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLAGS_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {};
    }
    const payload = (await response.json()) as TogglyApiPayload | Flags;
    const defs = (payload as TogglyApiPayload).defs;
    return (defs ?? (payload as Flags)) as Flags;
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Edge-cached flag fetch. The cache key includes the app key and environment
 * so multiple Pages projects sharing the Cloudflare Worker pool don't collide.
 */
async function loadFlags(env: Env): Promise<Flags> {
  const cacheKey = new Request(
    `https://toggly-edge-cache/flags/${encodeURIComponent(env.TOGGLY_APP_KEY)}/${encodeURIComponent(env.TOGGLY_ENVIRONMENT)}`,
  );
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    return (await cached.json()) as Flags;
  }

  const flags = await fetchFlagsFromTogglyApi(env);

  await caches.default.put(
    cacheKey,
    new Response(JSON.stringify(flags), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${FLAGS_CACHE_TTL_SECONDS}`,
      },
    }),
  );
  return flags;
}

/**
 * Build the inline script that pins `flags` onto the snapshot global.
 * `</script` is escaped defensively so a flag key/value containing the
 * sequence cannot break out of the script tag.
 */
function buildSnapshotScript(flags: Flags): string {
  const safeJson = JSON.stringify(flags).replace(/<\/script/gi, '<\\/script');
  return `<script>window.${SNAPSHOT_GLOBAL}=${safeJson};</script>`;
}

/**
 * Stream the HTML response through HTMLRewriter, stripping disabled
 * `[data-feature]` blocks and injecting the flag snapshot at the top of
 * `<head>`. Content-Length is dropped because the body length changes.
 */
function transformHtmlResponse(response: Response, flags: Flags): Response {
  if (!response.body) {
    return response;
  }

  const snapshot = buildSnapshotScript(flags);
  const transformer = new HTMLRewriter()
    .on('[data-feature]', {
      element(element) {
        const featureKey = element.getAttribute('data-feature');
        if (featureKey && !flags[featureKey]) {
          element.remove();
        }
      },
    })
    .on('head', {
      element(element) {
        // Prepend so the global is set before any deferred bundle script runs
        // and reads it during React hydration.
        element.prepend(snapshot, { html: true });
      },
    });

  const headers = new Headers(response.headers);
  headers.delete('Content-Length');

  return new Response(transformer.transform(response).body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isHtmlResponse(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('text/html');
}

/**
 * Pages Functions middleware entry point. Cloudflare invokes this for every
 * request before serving static assets. `next()` returns the static-asset
 * response (or the response from any subsequent middleware).
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Skip the manifest itself and obvious static-asset prefixes; these are
  // never HTML and never need feature gating.
  if (
    path === MANIFEST_PATH ||
    ASSET_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  ) {
    return next();
  }

  // Page-level gate: if this path is mapped to a flag and that flag is off,
  // short-circuit before we even fetch the static HTML.
  const manifest = await loadManifest(env);
  const featureKey = getFeatureKeyForPath(path, manifest);

  if (featureKey) {
    const flags = await loadFlags(env);
    if (flags[featureKey] === false) {
      const behavior = env.TOGGLY_PAGE_GATE_BEHAVIOR ?? '404';
      if (behavior === 'redirect') {
        const target = env.TOGGLY_REDIRECT_URL ?? '/';
        return Response.redirect(new URL(target, url).toString(), 302);
      }
      return new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }

  // Page is allowed (or unmapped). Pull the static asset and section-gate it.
  const response = await next();
  if (!isHtmlResponse(response)) {
    return response;
  }

  const flags = await loadFlags(env);
  return transformHtmlResponse(response, flags);
};
