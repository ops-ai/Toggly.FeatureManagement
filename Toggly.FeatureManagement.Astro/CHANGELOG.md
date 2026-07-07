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
