# Changelog

## 2.0.8

2026-06-28

### Added

- Device-local post-filter gates: `setLocalGates`, `notifyLocalGatesChanged`, and `subscribeLocalGatesChanged` apply a read-time AND on worker-evaluated booleans via `@ops-ai/toggly-local-gates`.
- `FeatureFlagDirective` subscribes to local gate changes and re-evaluates the view.
