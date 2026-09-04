# Ambient EvalContext providers Implementation Plan

> **For agentic workers:** Use subagent-driven development or executing-plans.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ambient EvalContext as default server DX for Node adapters and
Next/Nuxt/Remix, then ambient-first docs; other languages stay Linear backlog.

**Architecture:** Framework-native providers (middleware / ALS / event helpers)
bind one EvalContext per request; helpers and components read ambient;
per-call options override field-by-field. Shared contract only — no shared ALS
package.

**Tech Stack:** `@ops-ai/toggly-eval` `fromHttpRequest`, Node middleware,
Next RSC + AsyncLocalStorage/React cache, Nuxt H3 events, Remix loaders.

**Linear:** OPS-886 (epic); OPS-887 Node; OPS-888 Next; OPS-889 Nuxt;
OPS-891 Remix; OPS-890 Docs; OPS-892 backlog languages.

**Design:** `docs/plans/2026-09-04-ambient-eval-context-provider-design.md`

---

## File map

| Area | Primary files |
|------|----------------|
| Express | `Toggly.FeatureManagement.Node/toggly-express/src/{types,middleware}.ts` + tests |
| Hono | `…/toggly-hono/src/{types,middleware}.ts` + tests |
| Fastify | `…/toggly-fastify/src/{types,middleware}.ts` + tests |
| Koa | `…/toggly-koa/src/{types,middleware}.ts` + tests |
| Next | `nextjs-toggly-server/src/{eval-context-store,feature-check,server-client,components}.ts(x)` + tests |
| Nuxt | `nuxt-toggly-server/src/{middleware,server-client}.ts` + core types if needed |
| Remix | `remix-toggly-server/src/{loader,action,client}.ts` + core IdentityContext |
| Docs | `toggly_docs` `sdks/nodejs/*`, `sdks/nextjs/server.mdx`, `sdks/nuxt/server.mdx`, `sdks/remix/server.mdx`, `sdks/sdk-filter-matrix.mdx` |

---

### Task 1: Node — shared extractor contract (OPS-887)

**Files:**
- Modify: each adapter `types.ts` and `middleware.ts` (Express first as template)
- Test: each adapter `tests/middleware.test.ts`

- [ ] **Step 1:** Add optional `getGroups?: (req) => …` and
  `getClaims?: (req) => …` to Express config types (mirror on Hono/Fastify/Koa).

- [ ] **Step 2:** Write failing Express tests: `getClaims` / `getGroups` appear
  on `req.toggly.context`; Country from `cf-ipcountry` still set when using
  custom `getContext` without `request`.

- [ ] **Step 3:** Implement Express `extractContext`: call getIdentity /
  getGroups / getClaims; merge `fromHttpRequest`; if `getContext` provided,
  merge returned fields then fill missing `request` from headers.

- [ ] **Step 4:** Port same pattern to Hono, Fastify, Koa; run each package
  `npm test`.

- [ ] **Step 5:** CHANGELOG + minor bump each of four packages; commit
  `[OPS-887]`.

---

### Task 2: Next.js ambient store (OPS-888)

**Files:**
- Create: `nextjs-toggly-server/src/eval-context-store.ts`
- Modify: `feature-check.ts`, `server-client.ts`, `components.tsx`, `index.ts`
- Test: new unit tests under `nextjs-toggly-server/tests/`

- [ ] **Step 1:** Failing tests: after `runWithEvalContext({ identity, groups,
  claims, headers }, fn)`, `isServerFeatureOn('X')` uses ambient; explicit
  options override; nested override isolation.

- [ ] **Step 2:** Implement ALS (or React `cache`) store:
  `getAmbientEvalOverrides()`, `runWithEvalContext`, `withEvalContext(provider)`.

- [ ] **Step 3:** Wire `isServerFeatureOn` / `<Feature>` to
  `merge(ambient, perCall)`.

- [ ] **Step 4:** Export APIs; CHANGELOG + minor bumps for
  `nextjs-toggly-server` (and core if needed); commit `[OPS-888]`.

---

### Task 3: Nuxt ambient (OPS-889)

**Files:**
- Modify: `nuxt-toggly-server/src/middleware.ts`, server helpers, types
- Test: `nuxt-toggly-server/tests/middleware.test.ts`

- [ ] **Step 1:** Failing tests: event helpers bind claims/groups/request from
  provider + H3 headers, not identity-only.

- [ ] **Step 2:** Extend `bindRequestIdentity` → bind full EvalContext
  overrides; plugin/middleware registration for getIdentity/getGroups/getClaims
  or getContext.

- [ ] **Step 3:** CHANGELOG + minor bumps; commit `[OPS-889]`.

---

### Task 4: Remix ambient (OPS-891)

**Files:**
- Modify: `remix-toggly-server/src/{loader,action,client}.ts`, core types if needed
- Test: `loader.spec.ts`, `action.spec.ts`, `client.spec.ts`

- [ ] **Step 1:** Failing tests: loader `getClaims`/`getGroups` + headers →
  Country/UserClaims without per-call IdentityContext on subsequent
  `isEnabled`.

- [ ] **Step 2:** Extend loader/action options; bind ambient for duration
  (ALS or pass-through client wrapper); merge `fromHttpRequest`.

- [ ] **Step 3:** CHANGELOG + minor bumps; commit `[OPS-891]`.

---

### Task 5: Docs ambient-first (OPS-890)

**Repo:** `ops-ai/toggly_docs` base `develop`

- [ ] **Step 1:** Rewrite primary examples on Node/Next/Nuxt/Remix server pages
  to ambient setup; move per-call samples under Overrides.

- [ ] **Step 2:** Update `sdk-filter-matrix.mdx` ambient note.

- [ ] **Step 3:** `npm test`; PR `--base develop`; Oracle; commit `[OPS-890]`.

---

### Task 6: Hygiene

- [ ] Link design path on OPS-886; leave OPS-892 backlog untouched.
- [ ] Open FeatureManagement PRs against `develop` per wave (or one PR if
  sequential same branch — prefer separate PRs per Linear issue).
- [ ] Do not mark Done until Oracle pass + human/merge policy.

---

## Verification

| Wave | Check |
|------|--------|
| Node | `npm test` in each adapter package |
| Next/Nuxt/Remix | package vitest/jest suites |
| Docs | `npm test` in toggly_docs |
| All | `git diff --check`; PR base `develop` |
