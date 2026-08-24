# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.3] - 2026-08-23

### Added
- `buildEvaluatedSignedUrl()` so client SDKs share one evaluated/variants signed-defs URL builder.
- README notes for per-eval entity context (clients do not PUT schemas).

## [1.4.2] - 2026-08-19

### Added
- Entity context types and evaluation: `EntityGate`, `applyEntityGate`, `resolveEvaluatedDefinition`, `registerContext`.
- `normalizeEntityContext()` — resolves a registered kind + entity object or passes through a `TogglyEntityContext`.
- `evaluateEvaluatedGate()` — evaluates feature gates against mixed `EvaluatedDefinitions` with optional entity context (fail-closed without context).
- `evaluateResolvedKeys()` / `evaluateStoredFeatureKeys()` — shared any/all gate reduction so client SDKs do not reimplement the mixed-def loop.

## [1.4.1] - 2026-07-14

### Added
- `serializeJsonForInlineScript()` — JSON serialization that escapes `</script` for safe inline `<script>` embedding (Remix `TogglyScript`, Docusaurus `injectHtmlTags`, edge rewriters).

## [1.4.0] - 2026-07-11

### Added
- Pure LRU helpers for sidecar cache index (`emptyCacheLruIndex`, `parseCacheLruIndex`, `serializeCacheLruIndex`, `touchCacheLruKey`, `removeCacheLruKeys`, `selectCacheLruKeysToEvict`, `isCacheLruEnabled`) for client SDK `maxCacheKeys` eviction.
- `selectCacheLruKeysToEvict` accepts `protectKeys` (and legacy `protectKey`) so sibling flags/variants keys can be retained together during eviction.
- `parseCacheLruIndex` drops entries whose `lastAccessed` is not a finite number.

## [1.3.1] - 2026-07-05

### Added
- `MAX_EVALUATION_CLAIMS` (20) and `normalizeEvaluationClaims()`; URL builder and cache keys honor the same cap as the Definitions worker.

## [1.3.0] - 2026-07-05

### Added
- `TogglyEvaluationContext`, `appendEvaluationContext`, and `evaluationContextCacheKey` for shared client-side evaluated-signed URL building (identity, groups, claims).

## [1.2.0] - 2026-03-02

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
