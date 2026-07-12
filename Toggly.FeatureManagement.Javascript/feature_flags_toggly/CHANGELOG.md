## 1.5.0

2026-07-11

### Added
- `maxCacheKeys` opt-in LRU eviction for identity-scoped flags/variants localStorage entries (sidecar index at `toggly:cache-lru`).

## 1.4.0

2026-07-05

### Added
- `setContext({ identity, groups, claims })` and `clearContext()` for evaluated-signed targeting (User Claims, group rules).
- Evaluation cache keys include groups and claims so context changes trigger a refetch.

## 1.3.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

## 1.3.0

2026-07-05

### Changed
- ETag-based WebSocket sync: connect sends `sync` with definitions revision; clients pass `?rev=` and skip HTTP fetch when unchanged.
- Unified definitions revision cache (`toggly:revision:{appKey}:{env}`) for HTTP `If-None-Match` and WebSocket sync.
- Debounced refresh (300ms) and exponential WebSocket reconnect backoff (5s–60s).
- Handles `signing-key-updated` by forcing JWKS and definitions refresh.

## 1.2.0

2026-07-03

### Added
- `onError` and `lastError` expose refresh, cache, and storage failures to consumers.

### Fixed
- Preserved last-known-good flags after transient refresh failures instead of falling back silently to defaults.
- Failed closed for non-empty gates when no valid flags are available.

## 1.1.0

2026-06-28

### Added
- Device-local post-filter gates (`localGates`, `setLocalGates`, `notifyLocalGatesChanged`, `subscribeLocalGatesChanged`) that AND worker booleans at read time
- Variant reads respect local gates on the `enabled` field
- Dependency on `@ops-ai/toggly-local-gates` for shared gate logic

## 1.0.5

2026-06-16

### Fixed
- URL-encode `identity` when appending the `u` query parameter on
  `/evaluated-signed` requests so targeting filters match on the edge worker.

## 0.0.1

2022-11-21 (Date of Last Commit)

* Toggly classe & models
* Allow usage without Toggly service (by providing flagDefaults)
* Allow usage with Toggly service (by providing your App Key & Environment name)
* Feature evaluation methods unit tests
* Documentation
* License



