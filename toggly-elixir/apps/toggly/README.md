# Toggly for Elixir

Local feature flags for Elixir/OTP applications, with optional Phoenix and LiveView adapters. Can be used with or without [Toggly.io](https://toggly.io).

A feature flag is a named decision in your application. The environment's definitions decide which branch runs without requiring a deployment. The key (for example `new-dashboard`) must exactly match your dashboard key.

## Install and supervise

Requires Elixir **1.20+** and Erlang/OTP **29+**. Verified on Elixir 1.20.4 / OTP 29. `toggly`, `toggly_phoenix` and `toggly_live_view` start at **0.1.0**.

```elixir
# mix.exs
{:toggly, "~> 0.1.0"}

# Application.start/2 child list; create one named client per application/environment.
{Toggly,
 name: MyApp.Flags,
 app_key: System.get_env("TOGGLY_APP_KEY"),
 environment: "Production",
 defaults: %{"new-dashboard" => false}}
```

Use a **backend app key** from your application's settings. This is an SDK key, not a management API credential. Keys stay on the server. Signed definitions are enabled by default and verified before replacing the active snapshot. No key means defaults remain usable; `Toggly.refresh/1` returns `{:error, :missing_app_key}`.

```elixir
context = %{
  "identity" => "alice",
  "groups" => ["beta"],
  "claims" => %{"role" => "admin"},
  "request" => %{"country" => "US", "acceptLanguage" => "en-US"}
}

Toggly.enabled?(MyApp.Flags, "new-dashboard", context)
Toggly.enabled?(MyApp.Flags, ["new-dashboard", "api-v2"], context, requirement: :any)
Toggly.enabled?(MyApp.Flags, "maintenance", context, negate: true, default: false)
```

Multiple keys default to `:all`; an empty key list is false before negation. Missing keys use the configured defaults, then the call's `default:` (false). These are boolean branches; the SDK does not assign multivariate experiments or expose a variant API. Do not infer an experiment assignment from a boolean result.

## Explicit context and filters

Contexts are ordinary maps with **string keys**, supplied per evaluation. There is no global identity setter. Map authenticated identity, groups and claims from your request or socket. Demo identities are not authentication; feature gates do not replace authorization.

```elixir
context = Toggly.Context.from_headers(conn.req_headers, %{"identity" => current_user.id})

order_context =
  Map.put(context, "entity", %{
    "kind" => "Order",
    "key" => "ord-vip",
    "attributes" => %{"Vip" => true, "Total" => 120}
  })

Toggly.enabled?(MyApp.Flags, "ExpressCheckout", order_context)
```

A definition with ContextProperty filters requires a matching entity context even if an AlwaysOn user condition passes. Entity conditions combine with `contextRequirementType`; user conditions combine separately with `requirementType`. Both gates must pass. Attribute names compare without case; entity kind is exact.

Supported filters: AlwaysOn, AlwaysOff, Percentage, Targeting (users/groups/exclusions/default rollout), TimeWindow, UserClaims, Country/CountryFamily, BrowserFamily, BrowserLanguage, DeviceType, OS/OperatingSystem, and ContextProperty. Unknown/malformed filters fail closed. `Microsoft.` prefixes are accepted for compatibility; configure short names.

Use flattened backend parameters: `%{"Value" => 50}` for Percentage; `%{"Audience.Users:0" => "alice", "Audience.DefaultRolloutPercentage" => 0}` for Targeting. Segments require explicit `%{"Percentage" => 100}` plus e.g. `"Country:0" => "US"`. Claims use `"Claim" => "role", "Value" => "admin"`. ContextProperty uses `"Property" => "Vip", "Operator" => "eq", "Value" => "true", "ValueType" => "boolean"`. Operators: eq, neq, gt/gte/lt/lte (number/datetime), in, contains (string/string[]).

Percentage uses SHA-256 of `featureKey + "\n" + identity`, first 32 bits little-endian, divided by `0xFFFFFFFF` and multiplied by 100. Partial Percentage/Targeting rollouts without identity fail closed. Partial segment rollouts without identity sample randomly, matching the reference backend semantics. Prefer stable identities. UAParser supplies browser/device/OS data; desktop Mac is normalized to `Macintosh` for DeviceType, and OS matches `Mac`.

## Refresh, signatures and offline behavior

Evaluations read a protected ETS snapshot and do not wait for HTTP. A GenServer owns refresh, last-good state and subscribers. Periodic refresh defaults to 60 seconds; WebSockets invalidate definitions and signing keys. The supervisor restarts the socket after client failure. Stop the returned supervisor with `Toggly.stop/1`, or let your application's supervisor manage it.

| Option | Default | Purpose |
| --- | --- | --- |
| `name` | required atom/module | Named process and ETS table; use a fixed application module, never atoms derived from users |
| `app_key` | nil | Backend SDK key |
| `environment` | `Production` | Exact environment name |
| `defaults` | `%{}` | Offline boolean defaults |
| `base_url` | `https://definitions.toggly.io` | Definitions and JWKS origin |
| `signed` | true | Verify ES256 before activation; false explicitly opts into unsigned definitions |
| `jwks` | fetched from origin | Trusted configured JWKS; overrides persisted keys on restart |
| `max_signature_age_seconds` | nil (disabled) | Optional integer envelope age limit in seconds; nil/0/negative disable it; exact boundary is accepted |
| `allowed_kids` | `[]` | Optional trusted key-ID allowlist |
| `snapshot_path` | nil | Optional atomic signed envelope/public-key snapshot; use a durable host-owned directory |
| `refresh_interval` | 60000 ms | Poll interval; 0 disables automatic first fetch/polling |
| `websocket` | true | Real-time invalidation, only when app key exists |
| `debounce` | 300 ms | Coalesce WebSocket invalidation bursts |
| `reconnect_interval` | 5000 ms | Initial reconnect delay, exponential cap 60000 ms |
| `timeout` | 5000 ms | HTTP connect/read timeout |
| `usage` | true | Usage upload switch |
| `flush_interval` | 60000 ms | Usage batch interval; 0 disables timer |
| `usage_base_url` | `https://app.toggly.io` | HTTPS usage ingestion origin |

Signatures bind exact raw JSON bytes and timestamp, using the backend's double-SHA256 ES256 contract. Verification checks algorithm, curve, coordinate length, key ID derived from coordinates, optional key allowlist/expiry, duplicate JSON keys, future timestamps and rollback against the active timestamp. Raw definitions are never reserialized for verification. Failed refreshes preserve the previous definitions and ETag. With `snapshot_path`, successful signed refreshes atomically persist the original envelope and accepted **public** JWKS fetched from the configured HTTPS origin. A fresh client verifies this file before any network refresh, using configured `jwks` when supplied or the persisted public keys otherwise. Current `allowed_kids`, key expiry, signature age and full definition schema checks apply again. Key rotation requires updating a configured JWKS/allowlist when you pin keys.

Snapshots are scoped to the definitions endpoint, backend app key, environment and signed mode. Identity, groups, claims and entity context are never cached: this backend SDK stores raw definitions and evaluates each caller locally. Use a separate file per application/environment. Corrupt, oversized (over 5 MiB), unsupported-version, mismatched or unverifiable files fall back to defaults; successful live refreshes survive storage failures. JWKS responses are limited to 128 KiB and 32 unique ES256 keys. Legacy signed files without versioned context are ignored; explicitly unsigned local JSON fixtures remain supported with `signed: false`.

Persisted public keys are trusted **application-owned local state**, not an independent trust authority. Protect the directory with OS permissions. Independently configured `jwks` or coordinate-derived `allowed_kids` constrain whole-store key substitution; a signature alone cannot authenticate a replaced envelope plus its replaced local keyset. Snapshots do not provide whole-store rollback protection or indefinite offline validity. Key expiry and your configured signature age still apply.

```elixir
{Toggly,
 name: MyApp.Flags,
 app_key: System.fetch_env!("TOGGLY_APP_KEY"),
 environment: "Production",
 snapshot_path: "/var/lib/my-app/toggly-production.json",
 max_signature_age_seconds: 86_400}
```

A positive `max_signature_age_seconds` rejects a signed envelope when `now - timestamp` is **greater** than the limit; equality is accepted. Set an integer (for example `86_400` for one day); `nil`, `0` and negative integers disable only the age limit. Other types fail client startup validation. The existing 300-second future skew and active-timestamp rollback checks still apply. This setting is evaluated on **every signed activation**, including remote refresh and trusted file snapshots. It does not expire already active definitions: rejection preserves last-known-good flags and ETag. On a cold/offline start, a trusted snapshot older than the limit is rejected and defaults remain active until a sufficiently fresh, valid signed response arrives. Choose a limit that accommodates your expected outage/offline duration. Unsigned definitions are unaffected.

```elixir
Toggly.refresh(MyApp.Flags) # :ok or {:error, reason}
Toggly.snapshot(MyApp.Flags, context) # %{flags: boolean_map, source: ..., revision: ..., timestamp: ...}
Toggly.subscribe(MyApp.Flags)
# receive {:toggly_updated, MyApp.Flags, revision}; reevaluate with your own context
Toggly.unsubscribe(MyApp.Flags)
```

Each subscription is monitored; process death removes it. Definitions are immutable per activation; multi-key evaluation reads one snapshot. `snapshot/2` is a diagnostics view; avoid returning backend definitions/keys to browsers.

## Usage, metrics and Telemetry

Evaluations emit `[:toggly, :evaluation, :start | :stop | :exception]` via `:telemetry.span/3`. Stop metadata contains the boolean result. Metadata includes client and feature keys, never identity or claims. Set `track: false` for an evaluation that should not count toward usage.

Checks and explicit `Toggly.record_usage(client, key, enabled)` / `record_view` calls batch `variantStats` counters (`enabled` / `disabled`) to **POST /api/usage/stats**. Batches retry after errors and never include identity/claims or unique-user hashes. Unknown keys are excluded to bound cardinality. `Toggly.flush/1` explicitly uploads a batch; flush before graceful shutdown if final counts matter. Counters are memory-only; a process crash can lose an unsent batch.

`Toggly.metric(client, :counter | :measurement | :observation, key, value, metadata)` emits `[:toggly, :metric, kind]`. Attach your own Telemetry exporter. This version does **not** upload custom metrics through Toggly's gRPC metric service. Use metadata without personal data. Ecto/cache-specific adapters and automatic gRPC metrics export are separate integration extensions; built-in ETS reads/file snapshots need neither Ecto nor a cache service.

## Local development

```sh
mix deps.get
mix format --check-formatted
mix compile --warnings-as-errors
mix test --cover
mix hex.audit
python3 tools/build-packages.py # from the umbrella root
mix toggly.check definitions.json
# Signed local validation requires a trusted JWKS file:
mix toggly.check signed-definitions.json --jwks trusted-jwks.json
```

The grouped Elixir workflow enforces native format/compile/test/coverage checks. SonarCloud does not provide a native Elixir analyzer; no Sonar coverage or quality verdict is claimed. Dependency compiler warnings on OTP 29 are reported separately from SDK warnings. The manual Hex workflow publishes the manifest version, with no automatic bump or git commit. Package publication is a maintainer action.

## License and links

MIT. [Documentation](https://docs.toggly.io/sdks/elixir) · [Toggly](https://toggly.io) · [Phoenix showcase](https://github.com/ops-ai/Toggly.Samples/tree/develop/elixir-phoenix-sdk).
