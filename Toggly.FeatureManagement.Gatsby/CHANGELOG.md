## 1.6.1

2026-08-30

### Fixed
- After WebSocket `flags-updated`, do not cache the message etag before HTTP
  confirms the revision (avoids If-None-Match matching and a stale 304).
- Pin post-notify definitions GETs with `?rev=` and omit If-None-Match until
  the HTTP response updates the cached revision.

2026-08-28

### Added
- ETag-aware WebSocket live updates for the browser client (`sync` /
  `flags-updated` / `signing-key-updated`), with debounced refresh and
  exponential reconnect.
- `enableLiveUpdates` plugin option (default `true`). While the socket is
  connected, HTTP polling becomes a rare fallback (~20 minutes).
- Conditional GET via `If-None-Match` / `304 Not Modified` using the
  definitions revision cache.

## 1.6.0

## 1.5.3

- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-28

### Fixed
- Widen `react` / `react-dom` peerDependencies to `^18 || ^19` so installs
  succeed under npm with React 19 without `--legacy-peer-deps`.

## 1.5.2

## 1.5.1

2026-08-28

### Fixed
- Publish installable semver ranges for `@ops-ai/toggly-hooks-types`,
  `@ops-ai/toggly-local-gates`, and `@ops-ai/toggly-signed-defs` instead of
  `file:` paths that leave unmet dependencies after `npm install`.

## 1.5.0

2026-08-21

### Added
- Entity context evaluation on `getFlag` / `evaluateGate` with optional
  `registerContext` mappers. Entity gates fail closed without context.

## 1.4.1

2026-07-14

### Fixed
- Honor `verifySignatures` on server and client fetches (previously ignored). Uses `@ops-ai/toggly-signed-defs` with JWKS at `/.well-known/jwks`.

### Added
- Consolidate evaluated-signed response helpers into `@ops-ai/toggly-signed-defs`.
- Optional `allowedKeyIds` and `maxSignatureAgeSeconds` on plugin config for signature verification.

## 1.4.0

2026-07-05

### Added
- `groups` and `claims` options on plugin config for server-side evaluated definitions.

### Changed
- Evaluated-signed fetch URLs use `@ops-ai/toggly-hooks-types@^1.3.0` (`appendEvaluationContext`).

## 1.3.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-07-03

### Added

- `onError` reports client flag fetch failures to Gatsby SDK consumers.

### Fixed

- Error fallbacks now update the client error store instead of looking like clean ready/default state.
- Successful refreshes clear the last error after new flags are applied.

## [1.2.0] - 2026-06-28

### Added

- Device-local post-filter gates on the client store: `setLocalGates`, `notifyLocalGatesChanged`, and `$localGatesRevision` so `$flag` / `$gate` atoms apply a read-time AND via `@ops-ai/toggly-local-gates`.

## [1.0.3] - 2024-02-02

### Fixed

- Removed `.d.mts` TypeScript declaration files to eliminate Gatsby GraphQL parsing warnings
- Added `./package.json` export to package.json for Gatsby plugin validation

### Changed

- Updated build process to automatically remove `.d.mts` files after compilation
- Only `.d.ts` files are now included in the published package

## [1.0.2] - 2024-02-02

### Fixed

- Fixed package.json exports field to correctly map CJS (.js) and ESM (.mjs) module extensions
- Added explicit exports for Gatsby plugin entry files (gatsby-node, gatsby-ssr, gatsby-browser)

## [1.0.1] - 2024-02-02

### Fixed

- Fixed Gatsby plugin entry files to use correct CommonJS module extension (.js instead of .cjs)
- Fixed TypeScript type errors in client store and server client for optional `identity` property

## [1.0.0] - 2024-02-01

### Added

- Initial release of Gatsby SDK for Toggly feature flags
- Gatsby plugin integration with automatic setup
- Modern React hooks: `useFeatureFlag`, `useFeatureGate`, `useToggly`
- React components: `Feature`, `FeatureGate`, `TogglyProvider`
- Build-time page gating with frontmatter extraction
- Hybrid approach: build with all features enabled, filter at edge
- Reactive state management powered by nanostores
- TypeScript support with full type definitions
- User targeting with identity support
- Edge worker manifest generation
- Comprehensive documentation and examples
- Example Gatsby application demonstrating all features

### Features

- Server-side client with caching and build-time override
- Client-side store with automatic refresh intervals
- Page-to-feature mapping via `x-feature` frontmatter
- Manifest generation for edge worker filtering
- Debug logging support
- Configurable refresh intervals and timeouts
- Fallback values for offline/error scenarios

[1.0.0]: https://github.com/ops-ai/Toggly.FeatureManagement/releases/tag/gatsby-v1.0.0
