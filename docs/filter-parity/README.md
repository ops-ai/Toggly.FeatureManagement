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
closed (same as Go). Unknown filter names fail closed (`IgnoreMissingFeatureFilters`).

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
  "expected": true
}
```

- `filters` — one or more Definitions-style filters (same as feature definitions).
- `context` — EvalContext fields (optional keys omitted when unused).
- `httpHeaders` — optional; when present, map via `fromHttpRequest` (or
  equivalent) and merge over `context` before evaluate.
- `expected` — boolean result of evaluating the definition (`true` / `false`).
  Fail-closed cases use `false`.

Reference loader: `toggly-eval/src/filter-parity.fixtures.test.ts`.
