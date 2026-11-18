# Filter parity contract

Shared EvalContext + filter-name contract for server-side / local-eval SDKs.
Canonical behavior is `@ops-ai/toggly-eval` (and Go `toggly/eval` for segment
parity). Language ports must pass the golden fixtures in `fixtures/`.

Parent programme: [OPS-877](https://linear.app/opsai/issue/OPS-877). Design:
`docs/plans/2026-09-03-server-side-filter-parity-design.md` (when present on
the branch).

## EvalContext

Callers supply evaluation context as:

| Field | Type | Purpose |
|-------|------|---------|
| `identity` | string | Sticky percentage / targeting user |
| `groups` | string[] | Targeting audience groups |
| `claims` | `Record<string, string>` | `UserClaims` principal claims |
| `traits` | `Record<string, unknown>` | Legacy/custom attributes (optional) |
| `request.userAgent` | string | BrowserFamily, DeviceType, OS |
| `request.acceptLanguage` | string | BrowserLanguage |
| `request.country` | string | Country / CountryFamily |
| `entity` | `{ kind, key, attributes? }` | ContextProperty entity gates |

Per-call values override process/config defaults where both exist.

### HTTP → request mapping

`fromHttpRequest` (JS) and language equivalents map headers into
`EvalContext.request` without inventing identity/groups/claims:

| Request field | Header (first match wins) |
|---------------|---------------------------|
| `userAgent` | `user-agent` |
| `acceptLanguage` | `accept-language` |
| `country` | `cf-ipcountry`, then `x-vercel-ip-country`, then `cloudfront-viewer-country` |

Fixtures that include `httpHeaders` expect the port to apply this mapping
before evaluation (or to supply an already-mapped `context.request`).

## Canonical filter names

Registered names and aliases from `@ops-ai/toggly-eval`
(`createDefaultRegistry` + segment registration). Do not invent new names.

| Name | Aliases | Notes |
|------|---------|-------|
| `AlwaysOn` | | |
| `AlwaysOff` | | |
| `Percentage` | `Microsoft.Percentage` | Missing / `≤0` → false; sticky on identity |
| `TimeWindow` | `Microsoft.TimeWindow` | |
| `Targeting` | `Microsoft.Targeting` | Users + groups + default rollout |
| `ContextProperty` | | Entity attributes (engine-special) |
| `UserClaims` | | `Claim` + `Value` params |
| `BrowserFamily` | | Indexed `BrowserFamily:N` + `Percentage` |
| `BrowserLanguage` | | Indexed `BrowserLanguage:N` + `Percentage` |
| `Country` | `CountryFamily` | Indexed `Country:N` + `Percentage` |
| `DeviceType` | | Indexed `DeviceType:N` + `Percentage` |
| `OS` | `OperatingSystem` | Indexed `OperatingSystem:N` + `Percentage` |

Segment filters require a segment `Percentage` gate: missing or `≤0` fails
closed (same as Go). Unknown filter names fail closed for most SDKs
(treat as false / `IgnoreMissingFeatureFilters`-style). See
[Owner-approved SDK expectations](#owner-approved-sdk-expectations) for
documented exceptions.

UA parsing is best-effort parity with toggly-eval / .NET Web; bit-identical
UA trees across languages are not required.

## Fixture schema

Each file under `fixtures/*.json`:

```json
{
  "id": "stable-kebab-id",
  "description": "Human-readable intent",
  "featureKey": "feature-key-used-for-sticky-hash",
  "requirementType": "Any",
  "filters": [
    { "name": "BrowserFamily", "parameters": { "Percentage": 100, "BrowserFamily:0": "Chrome" } }
  ],
  "context": {
    "identity": "u",
    "groups": [],
    "claims": {},
    "request": { "userAgent": "...", "acceptLanguage": "...", "country": "..." }
  },
  "httpHeaders": {
    "cf-ipcountry": "US"
  },
  "expected": true,
  "sdkExpectations": {
    "dotnet": { "outcome": "error" },
    "node-core": { "allowedOutcomes": [true, false] }
  }
}
```

- `filters` — one or more Definitions-style filters (same as feature definitions).
- `context` — EvalContext fields (optional keys omitted when unused).
- `httpHeaders` — optional; when present, map via `fromHttpRequest` (or
  equivalent) and merge over `context` before evaluate.
- `expected` — default boolean result of evaluating the definition
  (`true` / `false`). Fail-closed cases use `false`. Harnesses that do not
  understand `sdkExpectations` must keep asserting against `expected` only.
- `sdkExpectations` — optional map of per-SDK contract outcomes. Keys are
  stable SDK ids (`dotnet`, `node-core`, …). Each entry may set:
  - `outcome`: `true` | `false` | `"error"` — exact boolean, or an evaluation
    error / thrown exception (`"error"`).
  - `allowedOutcomes`: `boolean[]` — any listed boolean is acceptable (no
    crash). Use when a SDK intentionally non-deterministically buckets.

Loaders must ignore unknown top-level fields and unknown
`sdkExpectations` keys so unrelated SDKs keep passing unchanged.

Reference loader: `toggly-eval/src/filter-parity.fixtures.test.ts`
(canonical `expected`). Node-core client harness:
`Toggly.FeatureManagement.Node/toggly-node-core/tests/filter-parity.fixtures.test.ts`.
.NET harness: `Toggly.FeatureManagement.NET/Toggly.FeatureManagement.Parity.Tests`.

## Owner-approved SDK expectations

These are contract outcomes, not temporary divergences. Do not change SDK
runtime behavior to force a single boolean when an entry below applies.

### `unknown-filter-fail-closed` → `dotnet`

Owner decision (Alexandru, 2026-11-02): the .NET SDK keeps **throwing** when a
feature uses an unknown/unregistered filter (`IgnoreMissingFeatureFilters =
false` in production registration). The shared fixture keeps
`expected: false` for fail-closed SDKs, and sets
`sdkExpectations.dotnet.outcome = "error"` so .NET asserts an evaluation
exception instead.

### `targeting-rollout-partial-anonymous` → `node-core`

Owner decision (Alexandru, 2026-11-02): `@ops-ai/toggly-node-core` (and
node-core-based JS SDKs) keep assigning an anonymous UUID when identity is
omitted, so partial Targeting default rollouts are **randomly bucketed**
instead of fail-closed. The fixture keeps `expected: false` for other SDKs,
and sets `sdkExpectations.node-core.allowedOutcomes = [true, false]`.
Harnesses should assert the outcome is boolean (no crash), not a fixed
bucket. Targeting **100%** and **0%** anonymous fixtures stay exact
(`expected: true` / `false`) with no node-core override.
