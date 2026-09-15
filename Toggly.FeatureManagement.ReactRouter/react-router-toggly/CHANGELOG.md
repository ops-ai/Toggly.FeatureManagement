# Changelog

## 1.0.0

### Added

- Initial `@ops-ai/react-router-toggly` release for React Router 7/8 framework mode
- Folded Remix core/client/server into one package with `./client` and `./server` exports
- In-source core (eval, telemetry, types) — no dependency on `@ops-ai/remix-toggly-core`
- Peers: `react-router ^7 || ^8`, `react` / `react-dom ^18 || ^19`, optional `@react-router/node`
- Packed host coverage for RR7+React 18 and RR8+React 19.2.7+

### Migration

- `@ops-ai/remix-toggly-*` is deprecated. Use `@ops-ai/react-router-toggly` instead.
- Rename `RemixTogglyProvider` → `RouterTogglyProvider`
- Import from `@ops-ai/react-router-toggly/client` and `@ops-ai/react-router-toggly/server`
