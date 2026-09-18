# Frontend telemetry contract fixtures

`contract.json` is the shared, language-neutral input for JavaScript, Dart,
Swift, Kotlin, and C# reporter tests. Read this committed source from this
repository; do not maintain independently edited copies.

- `schemaVersion`: fixture schema version (currently 1).
- `options`: defaults for every scenario; `scenario.options` overrides them.
- `scenarios[].events`: ordered `[method, ...arguments]` tuples using the
  public reporter method names. Omitted arguments use public defaults.
- `scenarios[].envelopes`: exact parsed JSON bodies in request order after a
  flush, with compression disabled by the test transport. Object member order
  is irrelevant; array element order and request order are significant.
- `transportScenarios`: record one counter at time zero, flush, and respond
  with successive `statuses` (or simulate `failure`). `retryAfter` is returned
  by every response when supplied. Compare relative `attemptTimesMs` after
  advancing the monotonic test clock by 310000 ms. There must be no additional
  attempts. A timeout transport never resolves; a network transport rejects.
- `policy`: binding bounds used for generated boundary cases, not permission
  to weaken native platform tests.
- `invariants`: additional common scenarios with explicit actions and outcomes
  for platform-specific harnesses. Each implementation must exercise these.

`recordCheck` is an owner API. Public SDK consumers use explicit usage/view
and metric APIs; authoritative evaluators supply automatic checks. Fixtures
contain test identifiers only. Never add real application keys or identities.
