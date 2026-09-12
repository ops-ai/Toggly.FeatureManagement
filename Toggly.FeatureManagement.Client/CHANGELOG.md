# Changelog

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
