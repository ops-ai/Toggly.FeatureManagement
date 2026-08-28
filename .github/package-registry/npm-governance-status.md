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
4. Configure **Trusted Publisher** per package → repository `ops-ai/Toggly.FeatureManagement`, exact `sdk-*-release.yml` filename, environment `npm-publish`. Proven: `@ops-ai/toggly-client-core` + `sdk-client-core-release.yml`.

## Notes

- Auth for CI is intended to be OIDC + `--provenance`; many workflows still pass `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` as fallback until Task 4 completes per group.
