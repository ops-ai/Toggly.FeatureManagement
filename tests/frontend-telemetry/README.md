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
- `endpointScenarios`: create a reporter with `options` plus the scenario's
  `metricsBaseUrl`, call `recordUsage("flag")`, then flush. A string
  `expectedUrl` requires exactly one request to that normalized URL; `null`
  requires no requests, no periodic timer/listener and an `invalid-option`
  diagnostic. Query/fragment delimiters are rejected even when their contents
  are empty. Percent-encoded delimiters are path data and remain encoded.
  Construct the route from the parsed URL and preserve its normalized base
  path; do not concatenate the route onto the unparsed input.
- `policy.variantPattern`: admitted variants contain only ASCII letters,
  digits, underscore and hyphen, with length 1 through 64. Invalid variants
  produce a bounded `invalid-event` diagnostic and must not alter previously
  accepted events or be remapped to `enabled`. Variant boundary and rejection
  cases are ordinary `scenarios` and apply to checks, usage and views.
- `policy`: binding bounds used for generated boundary cases, not permission
  to weaken native platform tests.
- `invariants`: additional common scenarios with explicit actions and outcomes
  for platform-specific harnesses. Each implementation must exercise these.

`recordCheck` is an owner API. Public SDK consumers use explicit usage/view
and metric APIs; authoritative evaluators supply automatic checks. Fixtures
contain test identifiers only. Never add real application keys or production
identities.

Optional reporter options `instanceId` and `identity` become compact body
fields `i` and `u`. When both are present, only `i` is serialized. Groups and
claims must never appear on the metrics body even if a harness passes them.

## Atomic context transition fixtures

`contextTransitionScenarios` is an additive section with the same
`name` / `options` / `events` / `envelopes` shape as `scenarios`. Existing scenario
consumers remain compatible. Transition-capable reporters must also consume this
section, require it to be nonempty, apply all events synchronously in order, and
flush once at the end. `setContext` events carry one context object; native
adapters map that operation to their atomic owning-context transition.

For `setContext`, omitted appKey/environment preserves routing, while omitted or
blank instanceId/identity clears attribution. Nonblank i takes precedence over
u. Accepted data keeps its previous k/e/i/u; new events are admitted immediately
under the replacement. Keep every partition under one global admission budget.
The vector includes anonymous events, client identities, minted token rotation,
blank-token fallback and logout. Platform tests additionally cover in-flight
sends, retry ordering, UTF-8 metadata bounds, empty transitions and cancellation.

These fixtures assert client serialization, not server acceptance of identity.
The server's `AcceptClientGeneratedIdentitiesForMetrics` application setting is
off by default. Unknown/expired i and unaccepted u can return 202 without
identity attribution; do not treat fixture parity or 202 as acceptance proof.
