## 1.1.0

2026-06-28

### Added
- Device-local post-filter gates (`localGates`, `setLocalGates`, `notifyLocalGatesChanged`, `subscribeLocalGatesChanged`) that AND worker booleans at read time
- Variant reads respect local gates on the `enabled` field
- Dependency on `@ops-ai/toggly-local-gates` for shared gate logic

## 1.0.5

2026-06-16

### Fixed
- URL-encode `identity` when appending the `u` query parameter on
  `/evaluated-signed` requests so targeting filters match on the edge worker.

## 0.0.1

2022-11-21 (Date of Last Commit)

* Toggly classe & models
* Allow usage without Toggly service (by providing flagDefaults)
* Allow usage with Toggly service (by providing your App Key & Environment name)
* Feature evaluation methods unit tests
* Documentation
* License



