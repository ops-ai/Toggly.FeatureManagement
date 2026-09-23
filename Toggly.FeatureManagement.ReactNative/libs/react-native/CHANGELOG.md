## 1.5.0 — 2026-09-22

### Added
- `useVariant(featureKey)` hook and `getVariant` / `getVariantValue` on `useToggly()`, surfacing Core's new `enableVariants` support. Re-renders after feature refresh or local gate changes.
- Re-exported `VariantResult` and `EvaluatedVariantDef` types from Core.

### Changed
- Depends on `@ops-ai/react-native-toggly-core` `^1.9.0`.

## 1.4.0 — 2026-09-21

### Added
- Forward token, identity, group, and claim changes through provider props and `useToggly().setContext`, including while initialization is pending.
- Frontend telemetry options on `TogglyProvider` and usage, view, counter, gauge, and flush methods on `useToggly`, using the owning Core client reporter.
- Best-effort AppState background/inactive flush and one bounded final flush on owner disposal.

### Fixed
- Synchronize early-mounted public state when initialization completes; count manual hook refreshes once while retaining reactive and offline evaluations.
- Cancel queued delivery when replacing the app/environment/collector owner while preserving normal final-unmount flush.
- Preserve the provider owner across ordinary rerenders; retire it when app, environment, or collector configuration changes.
- Keep feature hook results and metadata isolated from retired owners and late asynchronous completions.
- Dispose the preinitialized provider owner after its last mounted consumer, and create a fresh owner on later remounts.

## 1.3.0

2026-09-03

### Changed
- `<Feature>` no longer accepts a disabled-branch `fallback` prop. Use `negate` for the off path.

### Added
- Optional `context` / `contextKind` on `<Feature>`, `useFeatureFlag`, and `useFeatureGate`.

# Changelog


## 1.2.2

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.2.1

2026-08-28

### Fixed

- Publish `@ops-ai/react-native-toggly-core` as `^1.7.1` instead of a `file:`
  path so the package installs from npm.

## 1.2.0

2026-07-03

### Changed

- Bumped `@ops-ai/react-native-toggly-core` to 1.2.0 for observable errors and signed-definition reliability fixes.

### Fixed

- Provider, `Feature`, and `useFeatureFlag` now re-render from the `effectiveFlagsChanged` event so cached, fallback, local gate, and refreshed flags update UI consistently.

## 1.1.0

2026-06-28

### Changed

- Bumped `@ops-ai/react-native-toggly-core` to 1.1.0 for device-local post-filter gates support.
