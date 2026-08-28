## 1.2.1


## 1.2.2

- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-28

### Fixed

- Publish `@ops-ai/remix-toggly-core` and shared packages as caret ranges
  instead of `file:` paths so the package installs from npm.

## 1.2.0

2026-08-21

### Added
- `registerContext(kind, mapper)` on `TogglyProvider` context for domain-object
  → `TogglyEntityContext` mapping.
- Optional entity `context` / `kind` on `isEnabled`, `isDisabled`,
  `evaluateGate`, `useFeature`, `useFeatureGate`, and `<Feature>`.

### Fixed
- Entity gates in mixed `evaluated-signed` defs fail closed without context
  and evaluate against supplied entity context (previously `getEffectiveFlag`
  ignored context, so gated keys stayed false).

## 1.1.2

2026-07-14

### Fixed
- Escape `</script` sequences when serializing `TogglyScript` hydration JSON via `@ops-ai/toggly-hooks-types` `serializeJsonForInlineScript`, so attacker-influenced identity/flag strings cannot break out of the inline script tag.

## 1.1.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

## 1.1.0

2026-06-28

### Added

- `setLocalGates`, `notifyLocalGatesChanged`, and `subscribeLocalGatesChanged` on `TogglyProvider` context apply a read-time AND via `@ops-ai/toggly-local-gates`.
