# Ambient EvalContext providers (server DX)

**Linear:** [OPS-886](https://linear.app/opsai/issue/OPS-886/ambient-evalcontext-providers-server-dx)  
**Date:** 2026-09-04  
**Status:** Approved  
**mode:** medium (JS hosts + Node + docs; other languages backlog-only)

## Goal

Make ambient EvalContext the default server DX (like .NET `AddTogglyWeb` /
targeting accessors): configure identity, groups, claims, and request headers
once per request so feature checks and `<Feature>` do not require threading
props on every call.

[OPS-874](https://linear.app/opsai/issue/OPS-874) added per-call plumbing.
This programme flips the happy path to ambient; per-call options remain
overrides.

## Decisions

| Topic | Choice |
|-------|--------|
| Approach | Framework-native ambient (not shared ALS package) |
| Contract | Shared field + merge rules; idiomatic registration per host |
| Build now | Node (Express/Hono/Fastify/Koa) → Next → Nuxt → Remix → docs |
| Later | Go / Java / Python / Ruby / Rust / PHP ambient DX in Linear backlog |
| .NET | Already ambient — no change |
| Overrides | Per-call options override ambient field-by-field |

## Shared contract

One ambient `EvalContext` per request:

| Field | Source |
|-------|--------|
| `identity` | App provider (`getIdentity`) |
| `groups` | App provider (`getGroups` or `getContext`) |
| `claims` | App provider (`getClaims` or `getContext`) |
| `request` | Always from HTTP headers via `fromHttpRequest` (UA / Accept-Language / country) |

**Merge:** ambient default; explicit per-call fields win. Missing fields stay
undefined (existing fail-closed / unconstrained filter rules).

**Concurrency:** never mutate a process-global client identity; bind
request-scoped context only.

## Node (Express / Hono / Fastify / Koa)

Middleware remains the provider.

- Optional `getGroups` / `getClaims`, or full `getContext`.
- Default path merges `fromHttpRequest` for `request.*`.
- If `getContext` is provided, still merge `request` from headers unless
  the returned context already sets `request`.
- Happy path: `req.toggly.isFeatureOn('X')` (or framework equivalent) with
  no args.

**Issue:** [OPS-887](https://linear.app/opsai/issue/OPS-887)

## Next.js

- `withEvalContext(provider)` / `runWithEvalContext(ctx, fn)` via
  request-scoped storage (`AsyncLocalStorage` and/or React `cache()`).
- Typical: bind once in middleware or root server helper with
  `identity` / `groups` / `claims` / `headers` → `fromHttpRequest`.
- Then `isServerFeatureOn('MobileCheckout')` and
  `<Feature featureKey="BetaBanner">` without context props.
- `FeatureCheckOptions` remain overrides.

**Issue:** [OPS-888](https://linear.app/opsai/issue/OPS-888)

## Nuxt

- Extend `useEventToggly` / event helpers to bind full EvalContext (not only
  `x-toggly-identity`).
- Plugin/middleware: `getIdentity` / `getGroups` / `getClaims` or
  `getContext`; auto-merge request headers from the H3 event.

**Issue:** [OPS-889](https://linear.app/opsai/issue/OPS-889)

## Remix

- Extend `createTogglyLoader` / actions beyond identity-only:
  `getGroups` / `getClaims` / `getContext`, merge `fromHttpRequest`.
- Bind ambient for loader/action duration so `isEnabled('X')` needs no
  `IdentityContext` arg; keep per-call override.

**Issue:** [OPS-891](https://linear.app/opsai/issue/OPS-891)

## Docs

- Lead Node/Next/Nuxt/Remix pages with ambient setup.
- Demote per-call samples to “Overrides.”
- Filter matrix: note ambient EvalContext for these hosts.
- Follow-up after SDK land (may supersede plumbing-first examples from
  OPS-879).

**Issue:** [OPS-890](https://linear.app/opsai/issue/OPS-890)

## Backlog (other languages)

Ambient DX for Go, Java, Python, Ruby, Rust, PHP — same contract; start only
after JS waves and as each language’s filter-parity wave is ready.

**Issue:** [OPS-892](https://linear.app/opsai/issue/OPS-892)

## Acceptance (JS scope)

1. Configure provider/middleware once → feature check / `<Feature>` works
   for segments + UserClaims without per-call props.
2. Per-call overrides still win field-by-field.
3. No process-global identity mutation under concurrent requests.
4. Docs primary examples are ambient.
5. CHANGELOG + minor bumps per touched package; tests green; PRs to
   `develop`.

## Out of scope

- Shared ALS package across frameworks
- Changing .NET Web
- Auto-deriving identity from cookies without an app-supplied extractor
- Browser / client remote SDKs
- Native filter-eval ports (OPS-880–884) — separate; link ambient AC when
  those languages ship

## Reference

- .NET: `AddTogglyWeb`, `ITargetingContextAccessor`, HTTP filters
- Node middleware: `toggly-express` / `toggly-hono` / `toggly-fastify` /
  `toggly-koa` `extractContext`
- Plumbing: `docs/plans/2026-09-03-eval-context-sdk-alignment-design.md`
  (OPS-874)
- Parent epic: OPS-877 filter parity
