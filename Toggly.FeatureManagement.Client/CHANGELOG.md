# Changelog

## 3.9.0 — 2026-09-18

### Added
- Portable and Desktop clients now aggregate actual feature checks and expose explicit usage, view, counter, gauge and awaitable flush APIs. Telemetry is enabled for keyed clients and can be opted out.
- Independent metrics endpoint, bounded in-memory batching, gzip and explicit rate-limit retries. Groups and claims stay off the telemetry body; optional `InstanceId` (`i`) and context identity (`u`) may be sent.
- `TogglyClientOptions.InstanceId` for minted instance ids. When both instance id and identity are set, only `i` is serialized.

### Fixed
- Telemetry flush cancellation completes without throwing while preserving shared delivery ownership.
- Diagnostic callbacks emit each fixed code at most once per client lifetime.


## 3.8.0 — 2026-09-14

### Changed
- Align package and assembly versions with the shared .NET SDK version.

## 3.7.0 — 2026-09-13

### Changed
- Align package and assembly versions with the shared .NET SDK version.
- Keep internal Toggly dependencies on that same version.

## 0.1.0 — 2026-09-12

### Added
- Portable .NET 8 frontend client with mandatory signed evaluated delivery, user and entity context, local gates, context-isolated snapshots, live invalidation, polling and asynchronous lifecycle.
- Desktop companion with native ES256 verification and atomic file storage; console and Avalonia integration examples.

### Fixed
- Observe cancellation explicitly after delayed HTTP transports complete, consistently across .NET 8 and .NET 10 hosts.
- Restore versioned, signed file snapshots before network access using the exact accepted public verification keys; keep explicit host key configuration and already observed session keys authoritative.
- Capture verification keys per refresh and discard obsolete key fetches when signing-key rotation interleaves with asynchronous work.
- Handle plaintext and JSON live invalidations without reusing stale conditional cache state; route revision notifications through the signed HTTP endpoint.
- Drain superseded refreshes during debounce replacement and disposal, preserving subscriber exception isolation.
- Pin release and analysis actions, use HTTPS timestamping, and include the client packages in dependency scanning.
