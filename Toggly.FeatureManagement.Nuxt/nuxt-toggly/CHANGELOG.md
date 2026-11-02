# Changelog

## Unreleased

### Changed
- Widen `@nuxt/kit` (and `@nuxt/schema` for local typing) to `^3.16.0 || ^4.0.0` so Nuxt 4 hosts resolve kit 4.x while Nuxt 3 keeps the 3.16+ floor.
- Declare Node `>=22` (Node 18/20 dropped). Packed hosts and CI now prove Nuxt **3.21.11** and **4.6.3** on Node 22/24/26.
- Packed-host consumer Vue pin `3.5.42` → `3.5.44` so Nuxt 4.6’s `vue@^3.5.44` floor does not leave a duplicate Vue graph for Nitro tracing.
- Leave `h3` peer at `^1` on the server package: Nuxt 4.6.x / `@nuxt/nitro-server` still depend on `h3@^1.15`, not stable `h3@2`.

## 1.4.0 — 2026-09-22

### Added
- Module config accepts `enableVariants`, forwarded to both the client and server plugins. When enabled, `useVariant()` (client) and `getServerVariant()` / `getServerVariantValue()` (server, auto-imported) resolve assigned variants instead of plain booleans.
- Configure Nitro usage tracking and metrics independently with `serverEnableUsageTracking` and `serverEnableMetrics`. Omitted values preserve the server SDK defaults, while explicit `false` disables the selected server category without suppressing browser telemetry.

## 1.3.0 — 2026-09-18

### Added
- Nuxt browser runtime configuration now forwards compact frontend telemetry settings and disposes its client owner during application teardown.

- Forward host-provided instance tokens with `i` precedence over `u`, preserve queued attribution across context changes, and capture evaluated state before callbacks.
- Keep browser context caches bounded and pair validators with the matching body and response mode; failed context refreshes never restore a retired user.
- Ignore unrelated SSR/legacy snapshots for minted contexts and tolerate unavailable browser storage.

### Changed
- Frontend telemetry is enabled by default for configured browser clients; SSR and trusted Nitro server telemetry remain independently owned and unchanged.

## 1.2.0 — 2026-09-12

### Added
- Support Nuxt 4 alongside Nuxt 3 with packed production-host verification.
- Provide request-isolated Vue SSR flags and evaluated-boolean hydration snapshots.

### Fixed
- Resolve runtime plugins from the built module directory and write the callback template for Nitro.
- Register server utilities in Nitro auto-imports and provide the symbol consumed by Vue composables.
- Close the server client during Nitro shutdown.
- Apply hydration through the core snapshot API so public core checks and Vue flags agree before network initialization.
- Keep hydration snapshots separate from fallback defaults when browser identity changes.

## 1.1.2 — 2026-09-08

### Fixed
- Forward and snapshot configured groups and claims before client and server initialization. The first client evaluation now includes the complete configured context without a second fetch.

## 1.1.1

2026-09-02

### Changed

- Pin sibling `@ops-ai/nuxt-toggly-*` packages with `workspace:^` so publish resolves compatible semver ranges instead of exact snapshots that can strand installs on two core copies.

## 1.1.0

2026-08-28

### Changed
- Client and server plugins forward `enableLiveUpdates` from module options.
- Server plugin no longer forces live updates off; defaults come from
  `@ops-ai/nuxt-toggly-server` (WebSocket live updates on, `refreshInterval: 0`).

## 1.0.2

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.0.1

- Initial published package history tracked in this file.
