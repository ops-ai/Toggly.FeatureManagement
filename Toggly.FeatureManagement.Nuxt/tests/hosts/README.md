# Packed Nuxt compatibility hosts

From this workspace, run `pnpm install --frozen-lockfile && pnpm build`, then:

```sh
node tests/hosts/run.mjs 3.0.0    # retained Nuxt minimum
node tests/hosts/run.mjs 3.21.1 locked # committed candidate consumer lock
node tests/hosts/run.mjs 3.21.11  # current retained major
node tests/hosts/run.mjs 4.5.2    # current new major
```

Use Node 24.18+ for these current hosts. For the frozen retained Node 18
combination, use Node 18.20.8 and `node tests/hosts/run.mjs 3.16.2 locked`. The runner packs all four sibling
packages, installs them in an isolated temporary application, and runs Nuxt
prepare, public type checking, production build, real HTTP SSR, concurrent
request targeting, and headless Chromium hydration/identity/refresh checks.
Both Vue flags and public core `isFeatureOn`/gate checks must agree before
network initialization and after identity changes.
Install the matching Playwright Chromium browser if it is not already present.
The printed evidence directory preserves the resolved package-lock and build.
The `locked` mode copies the selected `locks/<version>/package.json` and
`package-lock.json`,
checks that the candidate package versions and dependency mode match, and runs
`npm ci` without resolving a fresh dependency graph. That lock records this
candidate consumer, not an inferred replay of the SDK workspace pnpm graph.
`fresh` (the default) resolves a new consumer graph and must be labeled as such.
Use `record` explicitly when intentionally updating a candidate consumer lock;
it records the graph and verifies it using `npm ci` before running the host.

The candidate boundary is four freshly packed Nuxt SDK siblings. All other
dependencies resolve from public npm, including an explicit signer **1.2.7**.
The runner rejects `TOGGLY_SIGNED_DEFS_ARTIFACT` and checks every dependency's
resolved URL; no dependency tarballs, aliases, overrides, or source links are
accepted. The two committed locks preserve all framework package versions from
the original snapshots; only signer 1.2.6's local artifact is replaced by the
public 1.2.7 release. This is pre-publication candidate evidence, not a claim
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
The printed evidence directory preserves the lock, packed artifacts, and build.

## Recorded host limitations

Nuxt 4.0.0's pinned Nitro 2.12.0 builds and serves SSR, but fresh production
installs can look for browser assets under `.output/server/chunks/public` and
return ENOENT. A plain Nuxt 4.0 control without this SDK reproduced the same
failure. Nuxt 4.5.2 passes the complete fixture. The peer range is not narrowed.

A fresh Nuxt 3.0.0 install on Node 18.20.8 resolves some transitive dependencies
requiring Node 20.19+ (`chokidar`/`readdirp`) or Node 20+ (`lru-cache`), and the
historical Nuxt telemetry loader fails on `import.meta`. That combination is not
passing Node 18 evidence. The retained Nuxt 3.0 fixture passes on Node 24.18;
the package engine declaration is unchanged. This fresh-resolution failure is separate from the passing frozen Node 18
combination below; it does not establish incompatibility for every Nuxt 3 host.

## Frozen Node 18 compatibility host

`locks/3.16.2/` records a real packed consumer on Node **18.20.8**, Nuxt and
Kit **3.16.2**, Nitro **2.11.9**, Vite **6.2.6**, Vue **3.5.13**, Nuxt CLI
**3.24.1**, TypeScript **5.7.3**, vue-tsc **2.2.4**, and Playwright **1.51.1**
with Chromium **134.0.6998.35**. The runner requires `locked` mode for this
profile and uses `npm ci --engine-strict`; fresh resolution cannot silently
replace it. It runs the same complete SSR, request-isolation, hydration, public
core/Vue agreement, gate, identity, refresh and directive assertions.

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
