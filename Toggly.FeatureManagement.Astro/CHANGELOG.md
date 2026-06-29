# Changelog

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
