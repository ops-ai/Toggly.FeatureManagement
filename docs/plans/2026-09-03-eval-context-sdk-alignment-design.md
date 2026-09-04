# Full EvalContext through local-eval SDKs

**Linear:** [OPS-874](https://linear.app/opsai/issue/OPS-874/pass-full-evalcontext-claims-groups-request-through-local-eval-sdks)
**Date:** 2026-09-03
**Status:** Approved
**mode:** large (one envelope)

## Goal

Wire `EvalContext.claims`, `groups`, and `request` (UA / Accept-Language /
country) through every local-eval JS framework SDK that currently drops them,
so segment filters and per-call UserClaims / Targeting groups work the same
way as `@ops-ai/toggly-eval` + Express.

## Decisions

| Topic | Choice |
|-------|--------|
| Canonical shape | Match Node `EvaluationContext` + Express `fromHttpRequest` |
| Next.js API | Extend `FeatureCheckOptions` with `groups`, `claims`, `request`, `headers` |
| Header helper | Re-export `fromHttpRequest` from Next/Nuxt cores |
| Cache keys | Hash groups + claims + request alongside identity/entity |
| Client DX | Next client gets `setContext({ groups, claims })` (optional identity) |
| Envelope | One PR covering Next, Nuxt, Remix, Hono/Fastify/Koa, Astro, Gatsby |
| Out of scope | Sample filter pages; browser remote SDKs; .NET; Python/Java/Ruby |

## Architecture

```
Caller (RSC / middleware / loader)
  → FeatureCheckOptions | IdentityContext | middleware extractContext
  → fromHttpRequest(headers) when headers provided
  → buildEvalContext(entity, overrides)
  → evaluateDefinitions / evaluateDefinition (toggly-eval)
```

Per-call overrides win over config defaults. Missing fields stay undefined
(segment filters fail closed / unconstrained per eval rules).

## Package bumps (functional → minor)

| Package | From → To |
|---------|-----------|
| `@ops-ai/nextjs-toggly-core` | 1.7.0 → 1.8.0 |
| `@ops-ai/nextjs-toggly-server` | 1.3.1 → 1.4.0 |
| `@ops-ai/nextjs-toggly-client` | 1.3.1 → 1.4.0 |
| `@ops-ai/nuxt-toggly-core` | 1.8.1 → 1.9.0 |
| `@ops-ai/nuxt-toggly-server` | 1.3.0 → 1.4.0 |
| `@ops-ai/remix-toggly-core` | 1.5.0 → 1.6.0 |
| `@ops-ai/remix-toggly-server` | 1.6.0 → 1.7.0 |
| `@ops-ai/toggly-hono` | 0.1.4 → 0.2.0 |
| `@ops-ai/toggly-fastify` | 0.1.4 → 0.2.0 |
| `@ops-ai/toggly-koa` | 0.1.4 → 0.2.0 |
| `@ops-ai/astro-feature-flags-toggly` | 1.12.0 → 1.13.0 |
| `@ops-ai/gatsby-feature-flags-toggly` | 1.8.0 → 1.9.0 |

## Acceptance

1. Next server helpers accept full options; local eval sets `request` when
   `headers` or `request` is passed.
2. Segment filters (e.g. Country from `cf-ipcountry`) evaluate true when
   headers match.
3. Per-call claims/groups override config.
4. Hono/Fastify/Koa set `EvalContext.request` via `fromHttpRequest`.
5. Astro/Gatsby pass `claims` (not only `traits`) into local eval.
6. CHANGELOG + version bump per package; tests green; PR opened.

## Reference

- Express: `Toggly.FeatureManagement.Node/toggly-express/src/middleware.ts`
- Eval: `toggly-eval/src/http.ts` (`fromHttpRequest`), `types.ts` (`EvalContext`)
