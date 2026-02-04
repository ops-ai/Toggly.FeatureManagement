# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-02-04

## [1.0.0] - 2024-02-04

### Added
- Initial release of `@ops-ai/toggly-hooks-types`
- Core `Hook` interface for extending Toggly SDK behavior
- `HookMetadata` interface for hook identification
- `EvaluationSeriesData` interface for evaluation lifecycle data
- `IdentitySeriesData` interface for identity lifecycle data
- Hook lifecycle methods:
  - `beforeEvaluation` - Called before feature flag evaluation
  - `afterEvaluation` - Called after feature flag evaluation
  - `beforeIdentify` - Called before identity is set/changed
  - `afterIdentify` - Called after identity is set/changed
  - `afterRefresh` - Called when flags are refreshed
- TypeScript type definitions
- Comprehensive README documentation
- MIT License
- Reference `HookExecutor` implementation

### Documentation
- Installation instructions
- Usage examples
- Hook interface specification
- Hook stage descriptions

[Unreleased]: https://github.com/ops-ai/Toggly.FeatureManagement/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ops-ai/Toggly.FeatureManagement/releases/tag/v1.0.0
