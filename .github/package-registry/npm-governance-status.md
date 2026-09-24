# npm `ops-ai` governance status (OPS-727 Task 1)

Recorded: 2026-08-28

## Organization

- Scope: `ops-ai` — **already an npm organization** (not a user account; no conversion needed).
- Do **not** create `@toggly/*` replacement packages.

## Current org members (`npm org ls ops-ai`)

| Member | Role |
|--------|------|
| `scatteredcode` | owner |
| `cosmin.atomei` | developer |

## Package maintainers (sample)

`@ops-ai/feature-flags-toggly` maintainers include `scatteredcode` and `cosmin.atomei`.

## Human gates still open

1. Add a **second company-controlled organization owner** (recovery admin). Verify login + 2FA from that account before any ownership removals.
2. Create a least-privilege **SDK publisher team** on the org; grant publish access to public `@ops-ai/*` packages only.
3. Inventory **granular/automation tokens** in npm and GitHub Secrets (`NPM_TOKEN`); do not revoke until every inventoried package has a verified OIDC publish (see Task 4).

## Trusted Publisher (closed 2026-09-24)

All inventoried `@ops-ai/*` packages have a GitHub Trusted Publisher for
`ops-ai/Toggly.FeatureManagement`, the package’s `sdk-*-release.yml`, and
environment `npm-publish`. Workflows publish with empty `NODE_AUTH_TOKEN` and
`--provenance` only. See [package-signing-inventory.md](package-signing-inventory.md).

## Notes

- Auth for CI is OIDC + `--provenance` (empty `NODE_AUTH_TOKEN`).
- Interactive Trusted Publisher setup (requires OTP): `.github/package-registry/configure-npm-trusted-publishers.sh`
- Do **not** revoke GitHub `NPM_TOKEN` / granular npm tokens until every inventoried package has a verified OIDC publish and an explicit OPS-727 approval comment.

## 2026-08-28 publish discovery (historical)

- Repository secrets do **not** include `NPM_TOKEN` (confirmed via `gh secret list`).
- Successful releases (Angular, JS, React, Vue, Svelte, Astro, Gatsby, Remix, RN, Next, Node, hooks, hooks-types, docusaurus) used **OIDC Trusted Publisher** with empty `NODE_AUTH_TOKEN`.
- At that time, `ENEEDAUTH` still hit packages missing Trusted Publisher config (`toggly-client-core`, `toggly-local-gates`, `toggly-signed-defs`, and others). Those publishers were configured and hardened on 2026-09-24.
