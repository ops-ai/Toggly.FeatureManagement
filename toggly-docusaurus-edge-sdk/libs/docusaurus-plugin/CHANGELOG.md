# Changelog

## 0.7.2

2026-08-28

### Fixed

- Add `.js` extensions on relative ESM imports so Node resolves the published
  `dist` graph without `ERR_MODULE_NOT_FOUND`.

## 0.7.1

2026-08-28

### Fixed

- Publish shared packages as caret ranges instead of `file:` paths so the
  package installs from npm.

## 0.7.0

2026-08-21

### Changed
- Widened the `react` and `react-dom` peer ranges to `^18.0.0 || ^19.0.0`. Docusaurus 3.10 supports React 19, and the client bindings use only stable hooks, so the React 18 ceiling was blocking consumers from upgrading.

## 0.6.3

2026-07-14

### Added
- `verifySignatures`, `allowedKeyIds`, and `maxSignatureAgeSeconds` on plugin options and build-time flag fetch.
- Signature verification via `@ops-ai/toggly-signed-defs` when `verifySignatures` is true.

## 0.6.2

2026-07-14

### Fixed
- Escape `</script` sequences in `injectHtmlTags` inline JSON scripts (`__TOGGLY_CONFIG__`, `__TOGGLY_PAGE_FEATURES__`, `__TOGGLY_BUILD_FLAGS__`) via `@ops-ai/toggly-hooks-types` `serializeJsonForInlineScript` (same contract as the Cloudflare edge rewriter).

## 0.6.1

2026-06-22

### Changed
- Published release of `staticGating` build-time flag mode (no API changes from 0.6.0).

## 0.6.0

2026-06-22

### Added
- `staticGating` plugin option: fetches Toggly flags once at build time and bakes
  gating into static HTML. No runtime API calls, WebSocket, or edge worker required.
- `isStaticGatingMode()` and `readBuildFlagsSnapshot()` client helpers.
- Build-time replacement of disabled `x-feature` pages with the site 404 HTML.

### Changed
- When `staticGating: true`, the `nav-gate` client module is not loaded (sidebar
  swizzles use the baked flag map instead).
