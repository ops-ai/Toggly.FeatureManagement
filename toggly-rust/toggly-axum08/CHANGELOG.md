# Changelog

## 0.1.1 - 2026-10-16

### Fixed

- Align the published `toggly` dependency with the Rust workspace range
  (`>=0.6.3, <0.11.0`) so applications can use current `toggly` releases
  (for example 0.9.x) without downgrading. Crates.io 0.1.0 still pinned
  `toggly ^0.6.1`.

## 0.1.0 - 2026-09-13

### Added
- Initial Axum 0.8 adapter, published separately from `toggly-axum` so Axum
  0.7 applications retain their existing dependency graph and public imports.
