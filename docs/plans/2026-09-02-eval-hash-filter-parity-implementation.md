# Eval hash and segment filter parity Implementation Plan

> **For agentic workers:** REQUIRED: Use subagent-driven-development (if subagents available) or executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align sticky SHA-256 buckets and segment identity filters across Definitions, Go, `@ops-ai/toggly-eval` / Node, and .NET per [OPS-832](https://linear.app/opsai/issue/OPS-832) and `docs/plans/2026-09-02-eval-hash-filter-parity-design.md`.

**Architecture:** Definitions remains the reference algorithm. Each runtime implements the same helper and filters, proven by identical golden vectors. Cascade: golden file → Definitions segment sticky → toggly-eval → Go → Node HTTP helpers → .NET.

**Tech Stack:** Cloudflare Worker TS (`Toggly.Definitions`), TypeScript (`toggly-eval`), Go (`toggly-go/toggly/eval`), .NET (`Toggly.FeatureManagement` + `.Web`), vitest / go test / xUnit.

**Linear:** OPS-832 (related OPS-825)

**Spec:** `docs/plans/2026-09-02-eval-hash-filter-parity-design.md`

---

## File map

| Path | Role |
|------|------|
| `Toggly/src/Toggly.Definitions/testdata/eval-percentile-golden.json` | Golden vectors (canonical copy in SaaS repo) |
| `Toggly/src/Toggly.Definitions/src/filter-evaluator.ts` | Sticky segment `%`; keep Percentage/Targeting |
| `Toggly.FeatureManagement/toggly-eval/testdata/eval-percentile-golden.json` | Copied golden file |
| `Toggly.FeatureManagement/toggly-eval/src/hash.ts` | Replace FNV with SHA-256 LE |
| `Toggly.FeatureManagement/toggly-eval/src/types.ts` | `request` + `claims` on `EvalContext` |
| `Toggly.FeatureManagement/toggly-eval/src/segment.ts` (new) | Browser/Country/Device/OS/Language/UserClaims |
| `Toggly.FeatureManagement/toggly-eval/src/builtin.ts` | Wire Percentage/Targeting + registry |
| `Toggly.FeatureManagement/toggly-go/toggly/eval/*` | Same as toggly-eval |
| `Toggly.FeatureManagement/.../Node/*` | Optional request→context helpers; version bumps |
| `Toggly.FeatureManagement.NET/.../Hashing` or new `Percentile.cs` | Definitions-aligned helper |
| `Toggly.FeatureManagement.NET/.../Web/Filters/*.cs` | Sticky segment `%` |
| Custom Percentage/Targeting filters or DI registration | Match Definitions seed order |

---

## Chunk 1: Golden vectors + Definitions

### Task 1: Check in golden vectors (SaaS)

**Files:**
- Create: `Toggly/src/Toggly.Definitions/testdata/eval-percentile-golden.json`
- Create: `Toggly/src/Toggly.Definitions/src/percentile-golden.test.ts` (or extend existing filter tests)

- [ ] **Step 1: Write golden JSON**

```json
[
  { "featureKey": "demo-feature", "userId": "user-123", "bucket": 60.099955033534194 },
  { "featureKey": "demo-feature", "userId": "user-456", "bucket": 42.58172634117811 },
  { "featureKey": "other-flag", "userId": "user-123", "bucket": 59.53490104515452 },
  { "featureKey": "Checkout", "userId": "alice@example.com", "bucket": 43.90914511026562 }
]
```

- [ ] **Step 2: Failing/asserting test that `computePercentile` matches each row** (export helper if private)

- [ ] **Step 3: Run** `npm test` in `Toggly/src/Toggly.Definitions` — expect PASS

- [ ] **Step 4: Commit** in SaaS repo with `[OPS-832]`

### Task 2: Sticky segment percentage in Definitions

**Files:**
- Modify: `Toggly/src/Toggly.Definitions/src/filter-evaluator.ts`
- Modify: existing filter evaluator tests
- Modify: `Toggly/src/Toggly.Definitions/CHANGELOG.md`

- [ ] **Step 1: Write failing tests** — with fixed `userId`, BrowserFamily (etc.) `%` gate is deterministic; without `userId`, gate can still pass via random path (mock or statistical not required — assert sticky path only)

- [ ] **Step 2: Change `passesSegmentPercentageGate(percentage, featureKey, userId?)`** — if userId → `computePercentile(userId, featureKey) < percentage`; else `Math.random() * 100 < percentage`

- [ ] **Step 3: Thread `featureKey` + context userId into all segment evaluators**

- [ ] **Step 4: Run tests; update CHANGELOG; commit `[OPS-832]`**

---

## Chunk 2: `@ops-ai/toggly-eval` + Go

### Task 3: SHA-256 hash in toggly-eval

**Files:**
- Create: `toggly-eval/testdata/eval-percentile-golden.json` (copy)
- Modify: `toggly-eval/src/hash.ts`
- Modify: `toggly-eval/src/builtin.ts` (Percentage uses featureKey+identity; Targeting rollout same)
- Modify: `toggly-eval/src/engine.test.ts` / hash tests
- Modify: package version + CHANGELOG

- [ ] **Step 1: Golden test fails against current FNV**

- [ ] **Step 2: Implement**

```ts
export async function computePercentile(userId: string, featureKey: string): Promise<number> {
  const input = `${featureKey}\n${userId}`
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  const value = new DataView(buf).getUint32(0, true)
  return (value / 0xFFFFFFFF) * 100
}
```

Prefer sync Node `crypto.createHash` in Node builds if `subtle` async forces API churn; keep evaluator sync by using `node:crypto` in package (already Node-oriented) **or** make evaluators async to match Definitions — **prefer sync `createHash` for toggly-eval** to avoid rewriting the whole engine async.

- [ ] **Step 3: Percentage** — `computePercentile(identity, featureKey) < pct` (not identity-only)

- [ ] **Step 4: Targeting default rollout** — same helper (not FNV `featureKey:identity`)

- [ ] **Step 5: Tests pass; bump version; commit `[OPS-832]`**

### Task 4: Segment filters + context in toggly-eval

**Files:**
- Modify: `toggly-eval/src/types.ts`
- Create: `toggly-eval/src/segment.ts`
- Modify: `toggly-eval/src/builtin.ts` / registry
- Create: `toggly-eval/src/segment.test.ts`
- Dependency: `ua-parser-js` (align with Definitions)

- [ ] **Step 1: Extend EvalContext**

```ts
claims?: Record<string, string>
request?: { userAgent?: string; acceptLanguage?: string; country?: string }
```

- [ ] **Step 2: Port segment evaluators from Definitions** (indexed params, contains/eq, sticky `%` helper)

- [ ] **Step 3: Targeting exclusions** if missing (`Audience.Exclusion.Users` / `Groups`)

- [ ] **Step 4: Register filter aliases** matching Definitions names

- [ ] **Step 5: Tests + commit `[OPS-832]`**

### Task 5: Go `toggly/eval` parity

**Files:**
- `toggly-go/toggly/eval/hash.go` (new or replace FNV)
- `context.go`, `builtin.go`, `defaults.go`, `segment.go`, tests, golden JSON copy

- [ ] **Step 1: Golden test fails on FNV**

- [ ] **Step 2: SHA-256 LE uint32 bucket matching TS**

- [ ] **Step 3: Port filters + Request/Claims on Context**

- [ ] **Step 4: `go test ./toggly/eval/...`; commit `[OPS-832]`**

### Task 6: Node server wiring

**Files:**
- `toggly-node-core` dependency bump on toggly-eval
- Optional: helpers in express/fastify/hono/koa to map headers → EvalContext
- CHANGELOGs / versions

- [ ] **Step 1: Bump `@ops-ai/toggly-eval` and fix broken tests from hash change**

- [ ] **Step 2: (Optional) `fromHttpRequest(req)` helper**

- [ ] **Step 3: Commit `[OPS-832]`**

---

## Chunk 3: .NET

### Task 7: Shared percentile helper + golden tests

**Files:**
- Create/Modify: helper under `Toggly.FeatureManagement` (e.g. `Evaluation/Percentile.cs`)
- Create: `testdata/eval-percentile-golden.json` + xUnit theory
- Modify: registration of Percentage / Targeting filters

- [ ] **Step 1: Golden tests fail if using MF order `userId\nfeatureKey`**

- [ ] **Step 2: Implement Definitions order `featureKey\nuserId`**

- [ ] **Step 3: Ensure DI uses Definitions-aligned Percentage/Targeting** (custom filters or documented override — stock MF TargetingFilter hint order must not win)

- [ ] **Step 4: Commit `[OPS-832]`**

### Task 8: Sticky segment Web filters

**Files:**
- `Toggly.FeatureManagement.Web/Filters/BrowserFamilyFilter.cs` (and Language, Country, DeviceType, OS, UserClaims)
- `FilterTests.cs`

- [ ] **Step 1: Tests with fixed user id → deterministic `%`**

- [ ] **Step 2: Resolve user id from `ITargetingContextAccessor` / HttpContext; if present use `Percentile`; else `RandomGenerator`**

- [ ] **Step 3: Pass feature name from `FeatureFilterEvaluationContext.FeatureName` into seed**

- [ ] **Step 4: Commit `[OPS-832]`**

---

## Chunk 4: Close-out

### Task 9: Linear + docs

- [ ] Comment on OPS-832 with implementation summary (do not edit description)
- [ ] Note UA parser caveats in CHANGELOGs
- [ ] Confirm golden JSON identical across three copies (Definitions, toggly-eval, Go, .NET)
- [ ] Oracle / ready-for-review only when user asks

---

## Execution notes

- **Repos:** Large/programme — orchestrate per repo/slice; root session must not implement and Oracle-pass the same slice.
- **Order:** Chunk 1 before publishing SDK changes that claim parity with edge.
- **Breaking:** Document FNV → SHA-256 cohort shift for pre-release toggly-eval / Go consumers from OPS-825.
