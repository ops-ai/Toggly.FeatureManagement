# Changelog


## 1.1.1

- Normalize public npm metadata for provenance and docs links (no API change).

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.1.0] - 2026-03-03

## [1.0.0] - 2025-02-04

### Added
- Initial release of `@ops-ai/toggly-clarity-hook`
- `ClarityHook` class implementing the Toggly `Hook` interface
- Automatic Microsoft Clarity event tracking on feature flag evaluation
- Configurable event prefix (default: `FeatureFlag:`)
- Consent management via `checkConsent` callback
- Auto-detection of Microsoft Clarity SDK
- Graceful error handling (never breaks SDK)
- Full TypeScript support
- Unit tests with >90% coverage
