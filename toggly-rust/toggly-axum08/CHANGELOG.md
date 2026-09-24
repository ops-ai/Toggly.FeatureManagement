# Changelog

## 0.2.0 - 2026-09-23

### Added
- `Feature::get_variant` / `get_variant_value` use the request-scoped
  evaluation context (identity from `X-User-Id` / `X-Identity`, or the
  client's config / `set_identity` when empty) [OPS-1407].

## 0.1.0 - 2026-09-13

### Added
- Initial Axum 0.8 adapter, published separately from `toggly-axum` so Axum
  0.7 applications retain their existing dependency graph and public imports.
