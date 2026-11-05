# Packed Nuxt compatibility hosts

From this workspace, run `pnpm install --frozen-lockfile && pnpm build`, then:

```sh
node tests/hosts/run.mjs 3.0.0    # retained Nuxt minimum (manual)
node tests/hosts/run.mjs 3.21.11 locked # current Nuxt 3 major (CI)
node tests/hosts/run.mjs 4.6.3 locked   # current Nuxt 4 major (CI)
```

Use Node 22.22+ / 24.15+ / 26+ for these current hosts (SDK engines:
`>=22`; Nuxt 4.6 also drops Node 20). Current hosts pin Playwright **1.64.1**
(≥1.60 required: 1.58.x hangs forever extracting Chromium on Node 24.16+/26
after download hits 100%). CI also sets a per-matrix `PLAYWRIGHT_BROWSERS_PATH`
so concurrent packed-host jobs do not contend on the shared Chromium cache.
The historical `locks/3.16.2/` Node 18.20.8 profile remains on disk as frozen
evidence only and is no longer a supported CI target. The runner packs all
four sibling packages, installs them in an isolated temporary application, and
runs Nuxt prepare, public type checking, production build, real HTTP SSR,
concurrent request targeting, and headless Chromium hydration/identity/refresh
checks.
Both Vue flags and public core `isFeatureOn`/gate checks must agree before
network initialization and after identity changes.
Install the matching Playwright Chromium browser if it is not already present.
Owned temporary applications and processes are removed after verification, including failures. Retain the command log as execution evidence.
The `locked` mode copies the selected `locks/<version>/package.json` and
`package-lock.json`, checks that candidate versions and dependency mode match,
and uses npm to bind the freshly packed local candidate archives. It asserts
that every public-registry lock entry remains identical, then runs `npm ci`.
This handles pnpm changing workspace dependency key ordering between packs
without editing integrity fields or changing the registry dependency graph. That lock records this
candidate consumer, not an inferred replay of the SDK workspace pnpm graph.
`fresh` (the default) resolves a new consumer graph and must be labeled as such.
Use `record` explicitly when intentionally updating a candidate consumer lock;
it records the graph and verifies it using `npm ci` before running the host.

The candidate boundary is four freshly packed Nuxt SDK siblings. All other
dependencies resolve from public npm, including an explicit signer **1.2.7**.
The runner rejects `TOGGLY_SIGNED_DEFS_ARTIFACT` and checks every dependency's
resolved URL; no dependency tarballs, aliases, overrides, or source links are
accepted. The retained locks preserve framework package versions from their
original snapshots; candidate versions and the public signer/reporter entries
are maintained with npm. A third lock records the Nuxt 4.6.3 consumer. This is pre-publication candidate evidence, not a claim
that all four candidate SDK versions are already published.

The first production host retains manual/defaults-only initialization coverage.
A second production process uses public runtime configuration to enable the
module's automatic `app:mounted` initialization. Its definitions server runs on
loopback. The browser holds the real startup response until hydration is
observed, verifies the SSR snapshot and core/Vue agreement, then releases it and
asserts exactly one request with the hydrated identity. It also verifies the
remote update, identity change, and refresh without clicking manual initialize.
Browser requests outside loopback are rejected and reported; server telemetry
is disabled. Both production processes are awaited through shutdown.

The server fixture seeds deterministic raw definitions in memory through the
existing hydration API. It tests framework integration, not signature acceptance;
core tests retain the signed/invalid/offline protocol cases. Local fixture IDs
are accepted only by loopback endpoints and never sent as production credentials.
The two current hosts use maintained public-registry locks. No lock integrity is patched by hand.

## Recorded host limitations

Nuxt 4.0.0's pinned Nitro 2.12.0 builds and serves SSR, but fresh production
installs can look for browser assets under `.output/server/chunks/public` and
return ENOENT. A plain Nuxt 4.0 control without this SDK reproduced the same
failure. Nuxt 4.6.3 passes the complete fixture when the consumer pins Vue
**3.5.44** (Nuxt 4.6's `vue@^3.5.44` floor); an older direct Vue pin can leave
duplicate Vue copies and an incomplete Nitro-traced `vue` package at runtime.
The peer range is not narrowed.

A fresh Nuxt 3.0.0 install on Node 18.20.8 resolves some transitive dependencies
requiring Node 20.19+ (`chokidar`/`readdirp`) or Node 20+ (`lru-cache`), and the
historical Nuxt telemetry loader fails on `import.meta`. That combination is not
passing Node 18 evidence. The retained Nuxt 3.0 fixture historically passed on
Node 24.18; current package engines declare `>=22` after the Node 18/20 drop.
This fresh-resolution failure is separate from the frozen Node 18 lock below.

## Frozen Node 18 compatibility host (historical; not CI)

`locks/3.16.2/` records a real packed consumer on Node **18.20.8**, Nuxt and
Kit **3.16.2**, Nitro **2.11.9**, Vite **6.2.6**, Vue **3.5.13**, Nuxt CLI
**3.24.1**, TypeScript **5.7.3**, vue-tsc **2.2.4**, and Playwright **1.51.1**
with Chromium **134.0.6998.35**. Owner support policy (2026-11-01) drops Node
18/20; this profile is retained as historical evidence only and is not part of
CI. The runner requires `locked` mode for this profile and uses
`npm ci --engine-strict`; fresh resolution cannot silently replace it.

Lock provenance (also recorded in `locks/3.16.2/provenance.json`): first resolve a framework-only manifest with the exact six
direct framework/tool versions shown in the profile (Nuxt, Kit, Vue,
Playwright, TypeScript, vue-tsc), using Node18.20.8 and
`npm install --package-lock-only --before=2025-04-15 --engine-strict --no-audit --no-fund`.
This creates a historical resolution snapshot; it is not a claim to have
recovered an existing application's historical lock. Then install the unchanged
packed SDK and the then-local signer into that lock with `--engine-strict`.
Every pre-existing framework package version was checked to remain identical;
30 SDK/dependency package entries were added. Finally copy the resulting
consumer manifest/lock into this fixture and independently replay it in a new
temporary host using `locked` mode. No dependency overrides, forced installs,
source aliases, SDK dependency changes, or support-range changes are used.

[Nuxt3.16.2](https://github.com/nuxt/nuxt/blob/v3.16.2/packages/nuxt/package.json) declares Node `^18.12.0 || ^20.9.0 || >=22.0.0` and Kit3.16.2
declares `>=18.12.0`. This proves one valid retained Node18/framework pairing;
it does not prove Node18.0.0, every Nuxt3 minor, or fresh current resolution on
Node18. This historical fixture is compatibility evidence, not a recommendation
to deploy an old framework/tool graph. The later registry refresh replaces only that signer entry with public 1.2.7;
all frozen framework versions remain unchanged. The four SDK candidate artifacts
remain local, as in the other packed hosts.

The browser matrix also checks minted-token targeting and exact compact `i`
payloads across owner replacement, token ABA and remote/local response-mode304
round trips, captured reentrant checks, and plain pagehide keepalive. Thirteen
real-resource controls cover failures, deliberate leaks, command descendants and
abortable HTTP header/body deadlines. Every host also verifies a real Playwright
evaluation deadline closes its owned Chrome process. `record --lock-only`
updates a maintained consumer graph with npm without claiming framework execution.
