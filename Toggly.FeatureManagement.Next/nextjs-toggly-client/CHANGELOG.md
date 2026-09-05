## 1.4.1

2026-09-04

### Fixed
- `setIdentity` / `setContext` publish React identity and persist to
  localStorage only after the core client succeeds; failures restore the
  prior identity and feature snapshot [OPS-828].
- When `persistFeatures` is enabled, valid last-known-good flags from
  localStorage seed React `features` (not only core defaults) [OPS-828].

## 1.4.0

2026-09-03

### Added
- `setContext({ identity?, groups?, claims? })` on the provider context and
  `useIdentity()` so client callers can update targeting without re-init
  [OPS-874].

## 1.3.1

2026-09-03

### Fixed
- Defer `TogglyProvider` unmount `destroy()` behind a mount-tracking microtask so
  React Strict Mode's synchronous mount/cleanup/remount cycle does not
  permanently brick the shared client (`[Toggly] Client has been destroyed` on
  later `init()` / `refresh()` in Next.js dev).

## 1.3.0

2026-09-03

### Added
- Optional `context` / `contextKind` on `<Feature>`, `<FeatureGate>`, hooks, and provider helpers
  for entity-gated flags (parity with the Next.js server package).

# Changelog


## 1.2.0

2026-09-02

### Changed
- `<Feature negate>` renders children when the flag is off, matching .NET
  `<feature negate>`. `<FeatureOff>`, the `fallback` prop, and
  `<Feature.Fallback>` are removed.

## 1.1.2

2026-09-02

### Changed

- Pin `@ops-ai/nextjs-toggly-core` with `workspace:^` so publish resolves a compatible semver range instead of an exact snapshot that can strand sibling packages on two core copies.

## 1.1.1

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.1.0

2026-07-03

### Fixed

- `TogglyProvider` now reacts to core feature refresh notifications so timer and WebSocket updates reach React state.
- Refresh failures preserve the current feature set and expose the core error state.
- `useFeatureFlag` and `useFeatureGate` stay in a loading state until the first post-init evaluation finishes, so callers do not read a stale `false` before `isFeatureOn` resolves.
