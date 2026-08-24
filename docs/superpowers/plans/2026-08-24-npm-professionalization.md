# npm Professionalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every `@ops-ai/*` coordinate while placing the scope under company governance, standardizing package metadata, and replacing token fallback with npm trusted publishing.

**Architecture:** Introduce one machine-readable inventory and contract test for all public npm manifests and release workflows. Apply metadata and release changes in framework-sized PRs; configure the matching npm trusted publisher before each workflow loses its token fallback.

**Tech Stack:** npm organizations, npm trusted publishers, Node.js 22.14 or newer, npm 11.5.1 or newer, GitHub Actions OIDC

**Spec:** `docs/plans/2026-08-24-package-registry-professionalization-design.md`

## Global Constraints

- Keep all `@ops-ai/*` names and the `ops-ai` scope.
- Exclude examples, workspace roots, Cloudflare Pages support packages, and every manifest with `private: true` from the public inventory.
- Use `Toggly <support@toggly.io>`, exact SDK docs, actual monorepo URL plus `repository.directory`, GitHub Issues, `MIT`, and standardized keywords.
- A published manifest change requires a patch bump and that package's changelog entry.
- Remove `NPM_TOKEN` only after the exact package/workflow trusted publisher succeeds.

---

### Task 1: Establish npm organization governance

**Files:**
- External: npm `ops-ai` account/scope, organization members, teams, and package access

**Interfaces:**
- Consumes: two company-controlled administrator accounts and the live public package inventory.
- Produces: company governance without changing package names.

- [ ] **Step 1: Determine account type and capture owners**

From a fresh signed-in npm session, record whether `ops-ai` is a user or organization, every public package in the scope, current owners, 2FA state, and existing granular tokens.

- [ ] **Step 2: Present the exact governance mutation**

If `ops-ai` is a user, propose conversion to an organization. If it is already an organization, propose only the missing administrators and maintainer team assignments. Obtain explicit approval.

- [ ] **Step 3: Apply additive access**

Ensure two company-controlled administrators and a least-privilege SDK publisher team exist. Verify recovery access from the second administrator before changing any current owner or token.

- [ ] **Step 4: Verify package isolation**

Confirm that every listed package still begins with `@ops-ai/`, installation commands are unchanged, and private/unrelated packages were not made public.

### Task 2: Add an npm package metadata inventory and contract

**Files:**
- Create: `.github/package-registry/npm-packages.json`
- Create: `.github/package-registry/verify-npm-metadata.mjs`
- Create: `.github/package-registry/verify-npm-metadata.test.mjs`
- Modify: `.github/RELEASE.md`

**Interfaces:**
- Consumes: all public npm manifests discovered from the release workflows.
- Produces: an exact manifest-to-workflow inventory and deterministic metadata validation.

- [ ] **Step 1: Write failing inventory tests**

The test must scan tracked `package.json` files, exclude `node_modules`, `dist`, examples, and `private: true`, and assert that every remaining `@ops-ai/*` manifest appears exactly once in `npm-packages.json`. It must also assert that every inventory workflow exists.

- [ ] **Step 2: Run the test and confirm the empty-inventory failure**

```bash
node --test .github/package-registry/verify-npm-metadata.test.mjs
```

Expected: failure listing all discovered public package manifests.

- [ ] **Step 3: Populate the inventory**

For every public package, record `name`, `manifest`, `changelog`, `workflow`, and exact documentation URL. Group packages under Angular, Astro, Gatsby, JavaScript, Next, Node server, Nuxt, React, React Native, Remix, Svelte, Vue, analytics hooks, Docusaurus, hooks-types, and local-gates.

- [ ] **Step 4: Implement metadata assertions**

Require exact `name`, `author`, `license`, `homepage`, `repository.url`, `repository.directory`, `bugs.url`, and core keywords. Reject GitHub URLs containing duplicated repository segments or `/tree/develop/`.

- [ ] **Step 5: Document the inventory contract**

Update `.github/RELEASE.md` so a new public npm package cannot ship until its inventory row, changelog, workflow, metadata contract, and trusted-publisher configuration exist.

### Task 3: Normalize npm metadata in release-sized groups

**Files:**
- Modify: every manifest named by `.github/package-registry/npm-packages.json`
- Modify: every changelog named by the inventory

**Interfaces:**
- Consumes: the metadata contract and exact per-package docs URL.
- Produces: professional live npm pages without new package names.

- [ ] **Step 1: Run the metadata test and save the failure list**

```bash
node --test .github/package-registry/verify-npm-metadata.test.mjs
```

Expected: failures for the observed author variants, missing homepage/repository-directory/bugs/keywords fields, and stale source links.

- [ ] **Step 2: Fix one framework group**

Set `author` to `Toggly <support@toggly.io>`, `license` to `MIT`, `homepage` to the exact Toggly SDK documentation page, `repository.url` to `git+https://github.com/ops-ai/Toggly.FeatureManagement.git`, `repository.directory` to the manifest's containing SDK directory, `bugs.url` to `https://github.com/ops-ai/Toggly.FeatureManagement/issues`, and standardized keywords. Preserve every `name`, exports map, dependency, peer-dependency, and runtime field.

- [ ] **Step 3: Bump and document that group**

Increment patch versions according to each workflow's synchronized-version rules and add a changelog entry describing metadata and provenance changes with no runtime API change.

- [ ] **Step 4: Validate and pack the group**

Run the group's existing install, lint/typecheck, test, build, and `npm pack --dry-run` commands from its release workflow. Inspect the tarball to confirm README, license, types, and built entrypoints remain present.

- [ ] **Step 5: Repeat Tasks 3.2-3.4 as separate PR slices**

Create independent Linear/PR slices for each inventory group. A failure in one framework must not block or expand another group's reviewed file set.

### Task 4: Replace token fallback with trusted publishing

**Files:**
- Modify: the npm `sdk-*release.yml` workflows named by the inventory
- Create: `.github/package-registry/verify-npm-trusted-publishing.mjs`
- Create: `.github/package-registry/verify-npm-trusted-publishing.test.mjs`

**Interfaces:**
- Consumes: an npm trusted-publisher record for each exact package and workflow.
- Produces: OIDC publication with provenance and no persistent publish token fallback.

- [ ] **Step 1: Write failing workflow tests**

Require `id-token: write`, Node `22.14.0` or newer, npm `11.5.1` or newer, `npm publish --provenance --access public`, and absence of `secrets.NPM_TOKEN`, `NODE_AUTH_TOKEN`, and `|| npm publish` fallback in publish jobs.

- [ ] **Step 2: Confirm current fallback workflows fail**

```bash
node --test .github/package-registry/verify-npm-trusted-publishing.test.mjs
```

Expected: failure for every workflow that still contains `NODE_AUTH_TOKEN` or token fallback.

- [ ] **Step 3: Configure trusted publishers package by package**

For each package, show the exact `ops-ai/Toggly.FeatureManagement` repository and workflow filename, obtain approval, and save one npm trusted-publisher record. Do not remove its workflow secret reference yet.

- [ ] **Step 4: Update the matching workflow group**

Set the required Node/npm floors, keep `id-token: write`, use one provenance-enabled publish command, and remove that group's `NPM_TOKEN` fallback. Preserve tests, build, package selection, synchronized versions, signing/tagging, and release notes.

- [ ] **Step 5: Verify and publish the group**

Run both contract tests and the framework commands from Task 3. Open a draft PR, run Oracle, obtain hosted green checks, publish the patch group, and verify npm provenance and install commands from fresh live package pages.

- [ ] **Step 6: Revoke superseded npm tokens**

After every public package has a verified OIDC release and explicit revocation approval, revoke obsolete granular/automation tokens. Retain only tokens that a documented non-GitHub publisher still requires.
