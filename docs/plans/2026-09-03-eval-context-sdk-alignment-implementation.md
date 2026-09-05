# Full EvalContext SDK alignment Implementation Plan

> **For agentic workers:** REQUIRED: Use subagent-driven-development or
> executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax.
> Work only in worktree
> `/Users/alexandrupuiu/development/Toggly/.worktrees/ops-874-eval-context`.
> Linear: **OPS-874**. Commit style: imperative subject + `[OPS-874]` + Linear
> Issues footer (no conventional-commit prefixes, no Co-authored-by).

**Goal:** Pass `claims`, `groups`, and `request` through local-eval JS SDKs so
segment and UserClaims filters work per-call.

**Architecture:** Extend each host’s eval builder to accept overrides; map HTTP
headers via `fromHttpRequest` from `@ops-ai/toggly-eval`; keep string identity
args backward-compatible.

**Tech Stack:** TypeScript, Vitest/Jest per package, `@ops-ai/toggly-eval@2`.

**Design:** `docs/plans/2026-09-03-eval-context-sdk-alignment-design.md`

---

## Chunk 1: Next.js core + server + client

### Task 1: Core — EvalContext overrides + tests

**Files:**
- Modify: `Toggly.FeatureManagement.Next/nextjs-toggly-core/src/client.ts`
- Modify: `Toggly.FeatureManagement.Next/nextjs-toggly-core/src/types.ts`
- Modify: `Toggly.FeatureManagement.Next/nextjs-toggly-core/src/index.ts`
- Modify: `Toggly.FeatureManagement.Next/nextjs-toggly-core/tests/local-evaluation.test.ts`
- Modify: `Toggly.FeatureManagement.Next/nextjs-toggly-core/package.json` → `1.8.0`
- Modify: `Toggly.FeatureManagement.Next/nextjs-toggly-core/CHANGELOG.md`

- [ ] **Step 1:** Add type for overrides (export from types or client):

```ts
export type EvalContextOverrides = {
  identity?: string
  groups?: string[]
  claims?: Record<string, string>
  request?: import('@ops-ai/toggly-eval').EvalContext['request']
}
```

- [ ] **Step 2:** Change `buildEvalContext` to accept overrides object instead of
  bare `identityOverride?: string`. Keep public `isFeatureOn` etc. accepting
  string identity **or** overrides (overload or `string | EvalContextOverrides`
  as last arg).

```ts
function buildEvalContext(
  entityContext?: ...,
  overrides?: string | EvalContextOverrides,
): EvalContext {
  const o =
    typeof overrides === 'string' ? { identity: overrides } : overrides ?? {}
  return {
    identity: o.identity ?? config.identity,
    groups: o.groups ?? config.groups,
    traits: o.claims ?? config.claims,
    claims: o.claims ?? config.claims,
    request: o.request,
    entity: entityContext ?? undefined,
  }
}
```

Propagate through `evaluateLocalFeature`, `getEffectiveFlag`,
`evaluateGateEffective`, `isFeatureOn` / `Off` / `evaluateFeatureGate`,
snapshots that take identity.

- [ ] **Step 3:** Re-export `fromHttpRequest` from `index.ts`.

- [ ] **Step 4:** Tests — local eval with Country / BrowserFamily definition +
  `request.country` / `userAgent`; claims override; groups override; string
  identity still works.

- [ ] **Step 5:** Bump to 1.8.0 + CHANGELOG `Added` section dated 2026-09-03/04.

- [ ] **Step 6:** `npm test` in `nextjs-toggly-core`. Commit.

### Task 2: Server — FeatureCheckOptions + cache keys

**Files:**
- Modify: `.../nextjs-toggly-server/src/feature-check.ts`
- Modify: `.../nextjs-toggly-server/src/server-client.ts`
- Modify: `.../nextjs-toggly-server/src/actions.ts`
- Modify: `.../nextjs-toggly-server/src/cache.ts`
- Modify: `.../nextjs-toggly-server/src/components.tsx` (optional props if Feature
  passes options through)
- Modify: `.../nextjs-toggly-server/tests/feature-check.test.ts`
- Modify: `.../nextjs-toggly-server/tests/server-client.test.ts`
- Modify: package.json → `1.4.0`, CHANGELOG

- [ ] **Step 1:** Extend `FeatureCheckOptions`:

```ts
export interface FeatureCheckOptions {
  identity?: string
  groups?: string[]
  claims?: Record<string, string>
  request?: NonNullable<import('@ops-ai/toggly-eval').EvalContext['request']>
  headers?: Headers | Record<string, string | string[] | undefined>
  context?: EntityContextInput
  contextKind?: string
}
```

- [ ] **Step 2:** In `resolveFeatureCheckArgs` / a new `toEvalOverrides(options)`:
  if `headers` set, `fromHttpRequest(normalizeHeaders(headers), { identity,
  groups, claims })` and merge explicit `request` (explicit wins on fields).

- [ ] **Step 3:** Update `createFeatureCacheKey` digest to include `g`, `cl`, `r`
  (sorted groups, stable claims, request). Identity-only path unchanged when no
  entity/groups/claims/request/headers.

- [ ] **Step 4:** Wire `isServerFeatureOn` / Off / actions / cache to pass full
  overrides into core (not only identity string).

- [ ] **Step 5:** Tests for headers→country, claims, cache key differentiation.

- [ ] **Step 6:** Bump 1.4.0 + CHANGELOG. `npm test`. Commit.

### Task 3: Client — setContext for groups/claims

**Files:**
- Modify: `.../nextjs-toggly-client/src/context.tsx`, `types.ts`, `hooks.ts` as needed
- Modify: package.json → `1.4.0`, CHANGELOG
- Add/extend tests if present

- [ ] Expose `setContext({ identity?, groups?, claims? })` that updates the
  underlying core client config (mirror any existing `setIdentity` pattern).
- [ ] Bump + CHANGELOG + test + commit.

---

## Chunk 2: Nuxt + Remix

### Task 4: Nuxt core + server

**Files:**
- `Toggly.FeatureManagement.Nuxt/nuxt-toggly-core/src/client.ts` (+ types/index)
- `Toggly.FeatureManagement.Nuxt/nuxt-toggly-server/src/server-client.ts` (+ types)
- Versions: core `1.9.0`, server `1.4.0` + CHANGELOGs

- [ ] Mirror Next.js `buildEvalContext` overrides + re-export `fromHttpRequest`.
- [ ] Extend `isServerFeatureOn` beyond string-only identity to options object
  with groups/claims/request/headers (same shape as Next if practical).
- [ ] Tests + bump + commit.

### Task 5: Remix core IdentityContext.request + server buildEvalContext

**Files:**
- `Toggly.FeatureManagement.Remix/remix-toggly-core/src/types.ts` — add:

```ts
request?: {
  userAgent?: string
  acceptLanguage?: string
  country?: string
}
```

- `remix-toggly-server/src/client.ts` — merge `identityOverride.request` into
  EvalContext; re-export `fromHttpRequest` from server or core index if useful.
- Versions: core `1.6.0`, server `1.7.0` + CHANGELOGs
- [ ] Tests + commit.

---

## Chunk 3: Node middleware + Astro/Gatsby

### Task 6: Hono / Fastify / Koa — use fromHttpRequest

**Reference:** `toggly-express/src/middleware.ts` `extractContext`.

**Files:** each of `toggly-hono`, `toggly-fastify`, `toggly-koa` middleware/plugin.

- [ ] Import `fromHttpRequest` from `@ops-ai/toggly-node-core` or `@ops-ai/toggly-eval`
  (match Express dependency style).
- [ ] Set `request: fromReq.request` on EvaluationContext; keep traits for
  path/method/ip as Express does (UA may remain in traits for BC).
- [ ] Update tests that assert traits-only UA if needed.
- [ ] Bump each `0.1.4` → `0.2.0` + CHANGELOG. Commit (one or three commits OK).

### Task 7: Astro + Gatsby claims on local eval

**Files:**
- `Toggly.FeatureManagement.Astro/src/server/toggly-server.ts` `buildEvalContext`
- `Toggly.FeatureManagement.Gatsby/src/server/toggly-server.ts` `buildEvalContext`

```ts
return {
  identity: this.config.identity,
  groups: this.config.groups,
  traits: this.config.claims,
  claims: this.config.claims, // ADD
  entity: entity ?? null,
}
```

Optional: accept per-call request later — not required if no public API for it;
minimum is claims forward.

- [ ] Add/adjust unit test asserting UserClaims filter uses `claims`.
- [ ] Astro `1.13.0`, Gatsby `1.9.0` + CHANGELOGs. Commit.

---

## Chunk 4: Verify + PR prep

### Task 8: Integration verify

- [ ] From worktree root, run tests for every touched package.
- [ ] `git status` / `git diff` / `git log origin/develop..HEAD` clean for secrets.
- [ ] Return candidate SHA + file list + commands/exit codes to orchestrator.
  Do **not** push or open PR unless asked; orchestrator opens PR after push
  when human requested PR.

### Commit message template

```
Add EvalContext claims groups request to Next local eval [OPS-874]

Local segment and UserClaims filters need request and per-call claims/groups.
Wire overrides through buildEvalContext and FeatureCheckOptions.

Linear Issues:
- OPS-874: Pass full EvalContext (claims, groups, request) through local-eval SDKs
```

(Adapt subject verb/package as each commit lands.)
