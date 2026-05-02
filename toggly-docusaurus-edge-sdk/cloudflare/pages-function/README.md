# Toggly Docusaurus Edge — Cloudflare Pages Functions

Drop-in Cloudflare **Pages Functions** middleware that enforces Toggly feature
flag gating on a Docusaurus site at the edge.

This is the Pages-native counterpart to the standalone Cloudflare Worker in
`../worker/`. **If your Docusaurus site is already deployed on Cloudflare
Pages, this is the recommended install path** — there's no second deployment,
no separate route, no redirect-loop risk, and no Cloudflare Access
service-token to manage.

## What it does

For every incoming request to your Pages site:

- **Page gating**: Checks `/toggly-page-features.json` (emitted by
  `@ops-ai/toggly-docusaurus-plugin`) for a flag mapping. If the flag is OFF,
  returns 404 (or a configurable redirect) before serving any HTML.
- **Section gating**: Streams HTML responses through `HTMLRewriter` and
  removes elements with `data-feature="<flag>"` whose flag is OFF.
- **Hydration-safe snapshot**: Prepends
  `<script>window.__TOGGLY_EDGE_FLAGS__ = {...}</script>` into `<head>` so
  the Docusaurus client SDK hydrates against the same view the edge served.
  Avoids React 18 hydration mismatches and the resulting client re-render flash.
- **Edge caching**: Flags cached for 30s and the manifest for 5min in
  `caches.default` so most requests don't touch the Toggly API or the
  static-asset store.

## Installation

### 1. Copy the middleware file

Drop `functions/_middleware.ts` from this directory into your Docusaurus
project as `functions/_middleware.ts`:

```bash
mkdir -p functions
curl -o functions/_middleware.ts \
  https://raw.githubusercontent.com/ops-ai/Toggly.FeatureManagement/main/toggly-docusaurus-edge-sdk/cloudflare/pages-function/functions/_middleware.ts
```

(Or copy the file by hand from this repo.) The middleware is intentionally
self-contained — **zero npm runtime dependencies**. Cloudflare Pages picks
up the `functions/` folder automatically on the next deploy and bundles it.

### 2. Set environment variables

In the Cloudflare dashboard, open your Pages project → **Settings** →
**Environment variables** and add the following for **Production** (and
**Preview** if you want flag gating on preview deploys):

| Variable | Required | Description |
|---|---|---|
| `TOGGLY_API_BASE_URL` | Yes | `https://definitions.toggly.io` |
| `TOGGLY_ENVIRONMENT` | Yes | `Production` (or your environment name) |
| `TOGGLY_APP_KEY` | Yes | Frontend app key from Toggly. **Mark as a Secret.** |
| `TOGGLY_PAGE_GATE_BEHAVIOR` | No | `404` (default) or `redirect` |
| `TOGGLY_REDIRECT_URL` | No | Path to redirect to when behavior is `redirect`. Defaults to `/`. |

`TOGGLY_APP_KEY` should be a **Frontend** app key (App Settings →
"Generate App Key" → Type: Frontend) for the environment you set in
`TOGGLY_ENVIRONMENT`.

### 3. Trigger a deploy

Push the `functions/_middleware.ts` change. Cloudflare Pages rebuilds and
attaches the function automatically. There's nothing to wire up in DNS or in
your zone — the function runs in front of your existing custom domain.

### 4. Verify

After the deploy is live:

```bash
# Should return the snapshot script in the HTML head.
curl -s https://docs.your-domain.com/ | grep -o '__TOGGLY_EDGE_FLAGS__.\{0,200\}' | head -1

# A page gated by an OFF flag should now 404 (or redirect, depending on config).
curl -I https://docs.your-domain.com/<a-gated-page>
```

## Local development

```bash
# In your Docusaurus project
npm run build               # produces ./build with the manifest
npx wrangler pages dev build \
    --binding TOGGLY_API_BASE_URL=https://definitions.toggly.io \
    --binding TOGGLY_ENVIRONMENT=Development \
    --binding TOGGLY_APP_KEY=your_dev_key
```

Then open `http://localhost:8788/`. The middleware applies the same gating
logic as production against your local build output.

## How it differs from the standalone Worker

| | Pages Function (this directory) | Worker (`../worker/`) |
|---|---|---|
| Where it runs | Inside your Pages deployment | Standalone Worker on a route |
| Deploy step | `git push` to your Pages repo | `wrangler deploy --env production` |
| Origin fetch | `env.ASSETS.fetch(request)` (in-process) | `fetch(ORIGIN_BASE_URL + path)` (cross-domain) |
| Cloudflare Access | Inherits the Pages domain's Access policy | Needs a separate service-token to bypass Access on the origin |
| Custom domain | Pages custom domain (unchanged) | Worker route on the public hostname |
| Best for | Sites already on Cloudflare Pages | Sites on GitHub Pages, Netlify, Vercel, S3, or any non-Pages origin |

If you're not sure which to use: **if your DNS already points at Pages, use
the Pages Function**. Otherwise use the Worker.

## License

MIT
