# Toggly Docusaurus Edge Worker

This Cloudflare Worker enforces feature flag gating at the network edge for your Docusaurus site. It ensures that users cannot access documentation for disabled features, even if they guess the URL.

## Features

-   **Page Gating**: Intercepts requests and checks if the requested path is mapped to a feature flag. Returns 404 or Redirect if disabled.
-   **Content Scrubbing**: Parses HTML responses and removes elements with `data-feature="flag_key"` attributes if the flag is disabled.
-   **Hydration-safe Snapshot**: Injects `<script>window.__TOGGLY_EDGE_FLAGS__ = {...}</script>` at the start of `<head>` with the resolved flag map. The companion `@ops-ai/toggly-docusaurus-plugin` reads this synchronously on first client render so the React tree matches the post-strip DOM and React 18 hydration succeeds without a recoverable error / full client re-render.
-   **Caching**: Caches feature flags and the page manifest at the edge to minimize latency.
-   **Usage + metrics**: Batches feature check/view (and optional measure/counter/observe) telemetry and posts gateway-accepted HTTPS JSON to `api/usage/stats` and `api/metrics` (Workers cannot use native gRPC). Flushes via `ctx.waitUntil` so responses stay fast; network errors soft-fail and never break flag evaluation.

## Deployment Guide

### 1. Prerequisites

-   A Cloudflare account.
-   `wrangler` CLI installed (`npm install -g wrangler`).
-   Your Docusaurus site deployed (e.g., on Cloudflare Pages, GitHub Pages, Vercel, etc.).

### 2. Configuration

Update `wrangler.toml` if you want to change the worker name or compatibility date.

You need to set the following environment variables. We recommend using `wrangler secret` for sensitive values like API keys.

| Variable | Description | Sensitive |
|----------|-------------|-----------|
| `TOGGLY_API_BASE_URL` | URL of the Toggly API (e.g. `https://definitions.toggly.io`) | No (use `[vars]`) |
| `TOGGLY_ENVIRONMENT` | Environment name (e.g. `Production`) | No (use `[vars]`) |
| `TOGGLY_APP_KEY` | Toggly application key for the docs project | Yes (use `wrangler secret put`) |
| `ORIGIN_BASE_URL` | URL where the static Docusaurus build is served (e.g. a Pages branch alias like `https://main.<project>.pages.dev`). The worker fetches HTML, the manifest, and assets from this origin. | No (use `[vars]`) |
| `TOGGLY_METRICS_BASE_URL` | Usage/metrics gateway base URL (defaults to `https://app.toggly.io/`) | No |
| `TOGGLY_USAGE_ENABLED` / `TOGGLY_METRICS_ENABLED` | Opt-out (`false`) for usage/metrics; default enabled when `TOGGLY_APP_KEY` is set | No |
| `CF_ACCESS_CLIENT_ID` | Cloudflare Access service-token client ID. **Only required** when `ORIGIN_BASE_URL` is gated by Cloudflare Access. | Yes |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service-token client secret. **Only required** when `ORIGIN_BASE_URL` is gated by Cloudflare Access. | Yes |

**Set secrets for production:**

```bash
wrangler secret put TOGGLY_APP_KEY --env production
# When ORIGIN_BASE_URL sits behind Cloudflare Access:
wrangler secret put CF_ACCESS_CLIENT_ID --env production
wrangler secret put CF_ACCESS_CLIENT_SECRET --env production
```

> **Cloudflare Access service tokens.** If you protect your Pages preview /
> alias URLs with Cloudflare Access (most teams do), the worker would
> otherwise receive a 302 to the Access login page on every origin fetch.
> Create a service token in **Zero Trust → Access → Service Auth** and add
> the token's UUID + secret as the two `CF_ACCESS_*` worker secrets above.
> Then in the Access policy that protects your origin hostname, add an
> include rule of type *Service Auth* referencing that token. The worker
> automatically attaches `CF-Access-Client-Id` and `CF-Access-Client-Secret`
> headers on every origin fetch when these env vars are set.

**Set non-sensitive vars in `wrangler.toml` (optional):**

```toml
[vars]
TOGGLY_API_BASE_URL = "https://definitions.toggly.io"
TOGGLY_ENVIRONMENT = "Production"
ORIGIN_BASE_URL = "https://my-docusaurus-site.pages.dev"
TOGGLY_METRICS_BASE_URL = "https://app.toggly.io/"
```

### 3. Deployment

This repo ships two named environments for the Toggly docs site:

| Wrangler env | Route | Origin |
|---|---|---|
| `production` | `docs.toggly.io/*` | `https://main.toggly-docs.pages.dev` |
| `staging` | `staging-docs.toggly.io/*` | `https://develop.toggly-docs.pages.dev` |

Deploy the worker to Cloudflare. Use the named environment so routes from
`[env.production]` or `[env.staging]` are picked up — without `--env` the
worker is uploaded with no triggers and effectively becomes unreachable:

```bash
npm run deploy:production   # docs.toggly.io
npm run deploy:staging      # staging-docs.toggly.io
```

After the first deploy you can verify the routes attached correctly:

```bash
wrangler deployments list --env production
```

### 4. Routing

You need to route traffic for your documentation site through this Worker.

**If using Custom Domains on Cloudflare Workers:**
1.  Go to your Worker in the Cloudflare Dashboard.
2.  Go to **Triggers** -> **Custom Domains**.
3.  Add your documentation domain (e.g., `docs.myapp.com`).

**If using Cloudflare Pages/Zones:**
1.  Go to your domain's **Workers Routes**.
2.  Add a route: `docs.myapp.com/*` -> `toggly-docusaurus-edge-worker`.

## Origin Configuration

The `ORIGIN_BASE_URL` tells the Worker where to fetch the actual content from.

### Cloudflare Pages Origin
If your site is on Cloudflare Pages (e.g., `my-docs.pages.dev`):
-   Set `ORIGIN_BASE_URL` to `https://my-docs.pages.dev`.
-   The Worker will proxy requests to this URL.

### GitHub Pages Origin
If your site is on GitHub Pages (e.g., `my-org.github.io/my-repo`):
-   Set `ORIGIN_BASE_URL` to `https://my-org.github.io/my-repo`.
-   Ensure your Docusaurus `baseUrl` is configured correctly in `docusaurus.config.js`.

## Local Development

You can test the worker locally using `wrangler dev`.

1.  Create a `.dev.vars` file in `cloudflare/worker`:

    ```env
    TOGGLY_API_BASE_URL=https://definitions.toggly.io
    TOGGLY_ENVIRONMENT=Production
    TOGGLY_APP_KEY=your_real_or_test_key
    ORIGIN_BASE_URL=http://localhost:3000
    TOGGLY_METRICS_BASE_URL=https://app.toggly.io/
    ```

2.  Run your Docusaurus site locally on port 3000:
    ```bash
    # In your docusaurus repo
    npm start
    ```

3.  Run the Worker locally:
    ```bash
    # In cloudflare/worker
    pnpm dev
    ```

4.  Open `http://localhost:8787/docs/some-page` to see the Worker proxying to your local Docusaurus instance with feature gating applied.

## Telemetry

When usage tracking is enabled, page and section gating records **check** (and **view** when enabled) into an in-memory batch. Business metrics APIs (`measure` / `incrementCounter` / `observe`) are available on the isolate-scoped runtime for callers that extend the worker.

- Transport: `POST` JSON to `{TOGGLY_METRICS_BASE_URL}api/usage/stats` and `.../api/metrics`
- User-Agent: `toggly-docusaurus-edge-worker/{version}`
- Wire fields: `variantStats` / `variantValues`; identity hashes are UTF-8 FNV-1a signed int32; HTTPS times are ISO-8601
- Caps: unique hashes per feature / app (10k), max features (500), metric keys (500), observations (1000)
- Flush: `ctx.waitUntil` after each request; for HTML, drain a teed rewriter stream first so section gates record, then flush (single-flight; restore batch on soft-fail)

Extend `getRequestContext` in `src/index.ts` to include `userId` (or other identity) for unique usage hashing.

## HTML Scrubbing

The Worker uses `HTMLRewriter` to enforce section-level gating.

**Input HTML (from Docusaurus):**
```html
<div data-feature="beta_feature">
  <h1>Beta Content</h1>
</div>
```

**If `beta_feature` is OFF:**
The Worker removes the entire `div` from the response stream.

**If `beta_feature` is ON:**
The HTML is passed through unchanged.

## Verify

```bash
npm test
npm run build
```
