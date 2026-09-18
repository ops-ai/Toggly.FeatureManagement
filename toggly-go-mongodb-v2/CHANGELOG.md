# Changelog

## 0.2.0

2026-09-17

### Changed
- Requires Go 1.25 and `toggly-go` 0.8.1. Applications can compile with
  current `golang.org/x/crypto` and `golang.org/x/net`, including
  `x/crypto` 0.52 and `x/net` 0.55 or later. 0.1.1 required `toggly-go`
  0.7.0, which failed to compile on Go 1.27 when `x/crypto` 0.52 selected
  `x/net` 0.54.

## 0.1.1

2026-09-17

### Changed
- MongoDB Go Driver v2 2.8.2 (CVE-2026-81521) and Driver v1 1.17.10
  (CVE-2026-88031). Keep `go 1.24.0` and grpc 1.80.0 [OPS-1263].

## 0.1.0

2026-09-12

### Added
- MongoDB Go Driver v2 snapshot adapter. Its documents use the existing
  Toggly MongoDB snapshot layout, so it can read snapshots written by the
  retained Driver v1 adapter [OPS-1175].
