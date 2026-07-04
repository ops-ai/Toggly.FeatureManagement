# Changelog

## 2.1.0

2026-07-03

### Added

- `onError` and `subscribeFeaturesRefresh` expose feature refresh failures and effective flag updates.

### Fixed

- Preserved loaded features on transient refresh failures instead of clearing UI state.
- `FeatureComponent`, `FeatureFlagDirective`, and `FeatureVariantDirective` re-evaluate when refreshed flags arrive.
- Failed closed for non-empty gates when no valid flags are available.

## 2.0.8

2026-06-28

### Added

- Device-local post-filter gates: `setLocalGates`, `notifyLocalGatesChanged`, and `subscribeLocalGatesChanged` apply a read-time AND on worker-evaluated booleans via `@ops-ai/toggly-local-gates`.
- `FeatureFlagDirective` subscribes to local gate changes and re-evaluates the view.
