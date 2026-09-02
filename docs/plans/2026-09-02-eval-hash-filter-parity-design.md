# Eval hash and segment filter parity design [OPS-832]

**Status:** Approved
**Date:** 2026-09-02
**Linear:** [OPS-832](https://linear.app/opsai/issue/OPS-832/align-eval-hash-and-segment-filters-across-definitions-go-js-and-net)
**Related:** [OPS-825](https://linear.app/opsai/issue/OPS-825) (definitions-signed local rail for Node/Next server SDKs)

## Problem

Local evaluation after OPS-825 (Go FNV / `@ops-ai/toggly-eval` FNV) does not match Cloudflare Definitions sticky buckets (SHA-256). Segment identity filters (BrowserFamily, BrowserLanguage, Country, DeviceType, OS, UserClaims) exist on Definitions and .NET Web but not on Go / `toggly-eval`. Segment nested `%` gates are non-sticky random. Stock Microsoft.FeatureManagement hashes `` `${userId}\n${hint}` ``, the reverse of Definitions’ `` `${featureKey}\n${userId}` ``.

## Goals

1. One canonical sticky-hash contract everywhere Definitions, Go, JS local eval, and .NET evaluate.
2. Full filter parity for the listed identity/request filters on Go and `toggly-eval` (Node server inherits).
3. Segment nested `%` sticky when identity is present; random fallback when absent.
4. Golden vectors so every runtime proves the same buckets.

## Non-goals

- Changing browser client packages (they stay on `evaluated-signed`; worker behavior covers them).
- Reworking OPS-825 endpoint selection (already definitions-signed for servers).
- Single shared WASM/binary eval core.

## Decisions (approved)

| Topic | Choice |
|-------|--------|
| Hash contract | Definitions SHA-256 of `` `${featureKey}\n${userId}` `` |
| Segment sticky seed | Same string as Percentage (correlated by design) |
| No identity (segment `%`) | Fall back to non-sticky random |
| No identity (Percentage / Targeting) | `<=0` → off; `>=100` → on (always); fail closed only for `(0, 100)` without identity |
| Approach | Spec + golden vectors, cascade Definitions → toggly-eval → Go → Node → .NET |
| MF string order | Do **not** adopt; .NET uses Definitions-aligned helpers |

## Canonical bucket algorithm

1. UTF-8 encode `` `${featureKey}\n${userId}` `` (exact newline `0x0A`).
2. SHA-256.
3. Interpret the first 4 bytes as little-endian `uint32`.
4. `bucket = (value / 0xFFFFFFFF) * 100` → `[0, 100)`.
5. In rollout iff `bucket < percentage` (`percentage <= 0` → off; `>= 100` → on).

**Identity short-circuit (amended OPS-832):** `<=0` and `>=100` apply **before** the identity check (match Definitions). Fail closed without identity only when percentage is in `(0, 100)` and a sticky bucket would otherwise be required.

Reference implementation today: `Toggly/src/Toggly.Definitions/src/filter-evaluator.ts` → `computePercentile`.

### Sample golden vectors

Check in as JSON (same bytes in each repo). Values from Node `crypto` SHA-256 LE uint32 / `0xFFFFFFFF * 100`:

| featureKey | userId | bucket |
|------------|--------|--------|
| `demo-feature` | `user-123` | `60.099955033534194` |
| `demo-feature` | `user-456` | `42.58172634117811` |
| `other-flag` | `user-123` | `59.53490104515452` |
| `Checkout` | `alice@example.com` | `43.90914511026562` |

## Filter semantics

| Filter | Sticky `%` | Context inputs |
|--------|------------|----------------|
| AlwaysOn / AlwaysOff | n/a | — |
| Percentage / Microsoft.Percentage | yes (fail closed w/o id) | identity |
| TimeWindow | n/a | clock |
| Targeting / Microsoft.Targeting | default rollout sticky; include/exclude users & groups | identity, groups |
| BrowserFamily | sticky if id else random | UA → browser family |
| BrowserLanguage | sticky if id else random | Accept-Language |
| Country | sticky if id else random | country (e.g. CF-IPCountry) |
| DeviceType | sticky if id else random | UA → device family |
| OperatingSystem | sticky if id else random | UA → OS family |
| UserClaims | sticky if id else random | claims map / principal |
| ContextProperty (entity) | existing | entity kind/key/attrs |

Param shapes stay Definitions / RavenDB flat keys (e.g. `BrowserFamily:0`, `Audience.Users:0`, `Claim` + `Value` for UserClaims).

## Architecture by runtime

### Definitions (Cloudflare worker)

- Keep existing Percentage / Targeting SHA-256.
- Change `passesSegmentPercentageGate` to accept `featureKey` + optional `userId`; sticky path when id present.
- Document behavior change in CHANGELOG (sticky vs random for identified users).
- Own / publish the golden vector file used by other repos (copy or submodule path documented in plan).

### `@ops-ai/toggly-eval` + Node server stack

- Replace FNV (`identityBucket` / `rolloutBucket`) with Definitions SHA-256.
- Extend `EvalContext` with `request` and `claims`.
- Register missing segment filters; Targeting exclusions if missing.
- `toggly-node-core` already on definitions-signed; bump eval dependency. Optional Express/Fastify/Hono/Koa helpers to map HTTP headers → context.

### Go `toggly/eval`

- Same hash + filters + context fields as `toggly-eval`.
- Mirror Targeting exclusions.

### .NET

- Shared `ComputePercentile(featureKey, userId)` matching Definitions.
- Register Definitions-aligned Percentage / Targeting (or wrappers) so buckets match Definitions, not stock MF order.
- Web segment filters: sticky when targeting user id available; else `RandomGenerator` fallback.
- Golden vector unit tests.

## Testing strategy

- Golden JSON: `{ featureKey, userId, bucket }` with high-precision expected floats (or integer comparison on the raw uint32).
- Per-runtime unit tests for each new filter (match / miss / % gate with fixed identity).
- Cross-check: same fixture evaluated in Definitions tests and `toggly-eval` tests.

## Rollout / versioning

- Definitions deploy first (edge + evaluated-signed browsers get sticky segment `%`).
- Publish `@ops-ai/toggly-eval` minor/major as appropriate (hash change is breaking for anyone on FNV from OPS-825 pre-release).
- Bump Go module / Node consumers / .NET packages with CHANGELOG notes calling out cohort shifts vs FNV and vs prior random segment gates.
- Keep OPS-825 related; do not block OPS-825 merge on full OPS-832 if hash follow-up is clearly tracked.

## Risks

- **Cohort shift:** users on FNV local eval (new JS/Go) or random segment gates will move when sticky SHA-256 lands.
- **UA parser drift:** `ua-parser-js` vs UAParser.NET vs Go parser may disagree on Family strings; document and prefer Definitions/`ua-parser-js` strings as reference for JS; accept best-effort on .NET/Go.
- **Multi-repo sync:** golden file must stay identical; prefer one checked-in copy per repo with a short sync note rather than a fragile shared package for v1.
