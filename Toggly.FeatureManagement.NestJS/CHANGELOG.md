# Changelog

## 0.1.0 — 2026-09-12

### Added
- NestJS 10/11 HTTP module with synchronous and asynchronous configuration.
- Request-scoped evaluation service, feature guards, decorators and parameter injection.
- Application-owned Node core initialization/shutdown, snapshots, signatures, live updates and telemetry.

### Fixed
- Require Node core 0.9.1 or newer so canonical Worker signatures are accepted before request-scoped evaluation.
- Verify canonical signature acceptance, tamper rejection and key rotation with independent public WebCrypto fixtures and installed adapter artifacts.
