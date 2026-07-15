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
