## 1.13.1

2026-09-05

### Fixed
- `setIdentity` / `setContext` withhold prior flags and restore on failed refresh [OPS-901].

## 1.13.0

2026-09-03

### Added
- Forward config `claims` as EvalContext.claims for UserClaims filters on
  the local-eval server rail [OPS-874].

## 1.12.0

2026-09-03

### Changed
- Removed disabled-branch `fallback` slot/prop from Feature components (Astro, React, Vue, Svelte islands).
  Use `negate` for the off path. Use `loading` on the React island for not-ready placeholders.

### Added
- Optional `context` / `contextKind` on Feature components and FeatureGateBuilders.

## 1.11.0

2026-09-02

### Changed
- Server client fetches `definitions-signed` (no identity query) and
  evaluates with `@ops-ai/toggly-eval` at `getFlag` / `evaluateGate`
  (OPS-825). Browser client remains on `evaluated-signed`.
- `enableVariants` still uses `evaluated-variants-signed` for remote
  variant assignment.
- Local evaluation depends on `@ops-ai/toggly-eval@^2.0.0` SHA-256
  sticky buckets (cohort shift vs FNV / eval 1.x) [OPS-832].

### Added
- Dependency on `@ops-ai/toggly-eval` for local definition evaluation.

## 1.10.0

2026-08-28

### Added
- ETag-aware definitions WebSocket live updates on the browser client store
  (`sync` / `flags-updated` / `signing-key-updated`), 300ms debounced refresh,
  exponential reconnect (5s–60s), and `enableLiveUpdates` (default true).
- Definitions revision cache with `If-None-Match` conditional HTTP fetches;
  when WebSocket is connected, the poll interval acts as a 20-minute fallback.

### Changed
- Align `SDK_VERSION` with the package version for WebSocket and HTTP identity.

## 1.9.1


## 1.9.2

- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-28

### Fixed
- Publish installable semver ranges for `@ops-ai/toggly-hooks-types`,
  `@ops-ai/toggly-local-gates`, and `@ops-ai/toggly-signed-defs` instead of
  `file:` paths that leave unmet dependencies after `npm install`.

## 1.9.0

2026-08-21

### Added
- Entity context evaluation on `getFlag` / `evaluateGate` with optional
  `registerContext` mappers. Entity gates fail closed without context.

## 1.8.1

2026-07-14

### Fixed
- Honor `verifySignatures` on server and client fetches (previously ignored). Uses `@ops-ai/toggly-signed-defs` with JWKS at `/.well-known/jwks`.

### Added
- Consolidate evaluated-signed response helpers into `@ops-ai/toggly-signed-defs`.
- Optional `allowedKeyIds` and `maxSignatureAgeSeconds` on `TogglyConfig` for signature verification.

## 1.8.0

2026-07-07

### Fixed
- Island `<Feature>` wrappers, composables, Svelte store helpers, and `FeatureClient.astro` now evaluate gates through `$gate` / `$flag`, so device-local post-filter gates apply correctly.

### Added
- React island `<Feature render={(enabled) => ...} />` render prop for conditional UI.
- Vue island `FeatureGateBuilder.vue` (scoped slot `{ enabled }`) and Svelte island `FeatureGateBuilder.svelte` (`let:enabled`) for conditional UI parity.

## 1.7.0

2026-07-05

### Added
- `groups` and `claims` options on `TogglyConfig` for server-side evaluated definitions.

### Changed
- Evaluated-signed fetch URLs use `@ops-ai/toggly-hooks-types@^1.3.0` (`appendEvaluationContext`).

## 1.6.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

# Changelog

## [1.6.0] - 2026-07-03

### Added

- `onError` reports client flag fetch failures to Astro SDK consumers.

### Fixed

- Error fallbacks now update the client error store instead of looking like clean ready/default state.
- Successful refreshes clear the last error after new flags are applied.

## [1.5.0] - 2026-06-28

### Added

- Device-local post-filter gates on the client store: `setLocalGates`, `notifyLocalGatesChanged`, and `$localGatesRevision` so `$flag`, `$gate`, and `$variant` apply a read-time AND via `@ops-ai/toggly-local-gates`.

## [1.1.0] - 2026-01-31

### Added
- Added `allFeaturesEnabledDuringBuild` configuration option to enable all features during static site generation (SSG/build time)
- This allows building static sites with all feature-flagged content included, while edge workers (like Cloudflare Workers) can filter content at runtime based on actual feature flag states
- During development, the plugin continues to use actual feature flags from the Toggly API

### Changed
- Updated `TogglyConfig` interface to include the new `allFeaturesEnabledDuringBuild` option
- Modified `TogglyServer` class to accept a `isBuildTime` parameter and respect the `allFeaturesEnabledDuringBuild` setting
- Enhanced integration hooks to properly handle build-time vs runtime client creation

### Use Cases
This is particularly useful for:
- Sites using edge workers (Cloudflare Workers, Vercel Edge, etc.) to filter content based on feature flags
- Ensuring all feature-flagged content is indexed by search engines during build
- Preventing broken links caused by features being disabled during build
- Maintaining a consistent static build while allowing dynamic feature toggling at the edge

## [1.0.6] - Previous versions
- Initial release with SSR, SSG, and framework support
