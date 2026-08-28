# Toggly Package Registry Professionalization Design

**Status:** Approved in conversation on 2026-08-24

**Tracking:** `OPS-724` with registry delivery children `OPS-725` through `OPS-734`

**Mode:** Large/programme

**Advisory upper estimate:** 9 independently reviewable delivery slices, 70-110 repository files, 25 release workflows, and 4-7 working days plus registry propagation and administrator availability. These numbers are planning estimates, not live execution gates.

## Problem

Toggly packages are technically available across the major language ecosystems, but ownership and presentation are inconsistent. In particular, Toggly NuGet packages share the personal-looking `opsai` profile with unrelated packages; other registries contain stale repository links, inconsistent company names and support addresses, mixed package icons, and long-lived publishing tokens where registries now support short-lived trusted publishing.

## Goals

- Move only existing `Toggly.*` NuGet packages into a company-controlled NuGet organization named `Toggly`.
- Preserve every public package coordinate, import path, group ID, scope, and repository-derived module URL.
- Create a recognizable square Toggly avatar suitable for Gravatar and registry profiles from the existing toggle-switch mark.
- Establish company-controlled ownership, recovery access, and least-privilege publishing on every registry.
- Standardize public metadata around the Toggly brand, canonical documentation, support address, source repository, issue tracker, license, and changelog.
- Replace persistent publish credentials with OIDC trusted publishing wherever the registry supports it.
- Release metadata changes through normal SemVer and changelog workflows.

## Non-goals

- Do not rename `@ops-ai/*` npm packages to `@toggly/*`.
- Do not move Go modules, Swift packages, or other GitHub-derived coordinates to a different repository path.
- Do not transfer BeyondAuth, Audit.NET, or any other non-`Toggly.*` NuGet package away from `opsai`.
- Do not replace Toggly's existing logo system with an AI-generated mark.
- Do not remove a working credential until a trusted-publishing release has succeeded on the exact workflow head.
- Do not publish package versions solely to make ownership changes that the registry can apply without a release.

## Compatibility contract

The following identifiers are immutable for this programme:

- NuGet: every existing `Toggly.*` package ID.
- npm: every existing `@ops-ai/*` package name.
- pub.dev: `feature_flags_toggly` and its four storage-provider packages.
- PyPI: `toggly`, `toggly-cache`, `toggly-django`, `toggly-fastapi`, and `toggly-flask`.
- RubyGems: `toggly`, `toggly-cache`, and `toggly-rails`.
- crates.io: `toggly`, `toggly-macros`, `toggly-actix`, `toggly-axum`, and `toggly-rocket`.
- Packagist: `toggly/feature-management-php`.
- Maven Central: the existing `io.toggly` group and artifact IDs.
- Go, Swift, and CLI: existing GitHub repository and tag-derived coordinates.

Any discovery that requires changing one of these identifiers is a material boundary change and must stop for renewed human approval.

## Public metadata contract

Use these values wherever the registry supports them:

| Field | Required value |
|---|---|
| Display publisher | `Toggly` |
| Support email | `support@toggly.io` |
| Product homepage | `https://toggly.io` |
| Documentation | The exact SDK page below `https://docs.toggly.io/docs/sdks/` |
| Source repository | The actual source repository, including monorepo directory metadata where supported |
| Issue tracker | The actual repository's GitHub Issues URL |
| License | `MIT` |
| Repository branch links | Stable default-branch or versioned links; never `develop` links for public package metadata |
| Keywords | `toggly`, `feature-flags`, `feature-management`, plus ecosystem-specific terms |

The legal copyright holder may remain `opsAI LLC` where required. Public author and publisher presentation should be `Toggly`.

## Registry decisions

### NuGet

The new `Toggly` organization becomes the final owner for the eleven packages in `.github/workflows/sdk-dotnet-release.yml`:

1. `Toggly.FeatureManagement`
2. `Toggly.FeatureManagement.Web`
3. `Toggly.FeatureManagement.Storage.RavenDB`
4. `Toggly.FeatureManagement.Storage.DistributedCache`
5. `Toggly.FeatureManagement.Hangfire`
6. `Toggly.FeatureManagement.HealthChecks`
7. `Toggly.FeatureManagement.NSwag`
8. `Toggly.FeatureManagement.Storage.MongoDB`
9. `Toggly.FeatureManagement.Storage.Dapper`
10. `Toggly.FeatureManagement.Storage.EntityFramework`
11. `Toggly.Metrics.SystemMetrics`

The transfer sequence is add organization as co-owner, accept all invitations, verify the package set, configure organization-owned trusted publishing, complete one controlled publish, and only then remove `opsai`. Apply separately for the reserved `Toggly.*` prefix. Preserve the existing Key Vault signing path; OIDC replaces NuGet publishing authentication, not package signing.

### npm

Keep `@ops-ai/*`. Verify whether `ops-ai` is already an npm organization; if it is a user account, convert it to an organization without changing the scope. Add at least two company-controlled administrators. Configure the exact repository and workflow as trusted publisher for every public package, then remove `NPM_TOKEN` fallback only after successful OIDC publishes. Standardize package metadata in release-sized framework groups.

### pub.dev

Keep the verified `toggly.io` publisher and existing OIDC automation. Only normalize documentation, issue tracker, repository path, README, and changelog metadata where live pages differ from the source contract.

### PyPI

If the recurring organization cost is approved, create the corporate `Toggly` organization and transfer all five projects without renaming them. Retain the current trusted-publishing workflows. Ensure organization roles include two owners and a publisher team; individual maintainers remain only where they provide an intentional recovery or stewardship role.

### RubyGems

RubyGems has owners rather than a company organization object. Add a company-controlled account as a named owner, retain at least one named recovery owner, and keep GitHub Actions trusted publishing. Change public author, email, homepage, source, and changelog metadata through patch releases.

### crates.io

Add a GitHub team such as `github:ops-ai:toggly-sdk-maintainers` as restricted team owner for all five crates and retain one named recovery owner. Configure crates.io trusted publishing for `.github/workflows/sdk-rust-release.yml`, verify a release, and revoke `CARGO_REGISTRY_TOKEN`. Normalize workspace metadata and repository URLs through a patch release.

### Packagist

Keep the `toggly` vendor and `toggly/feature-management-php`. Correct the live support email, add a second maintainer, verify the GitHub integration/webhook, and publish a stable tag through the standalone `ops-ai/Toggly.FeatureManagement.PHP` repository when its manifest and changelog are ready.

### Maven Central

Keep the verified `io.toggly` namespace. Put it under a Toggly Central Portal organization with at least two administrators. Use organization-scoped portal tokens and existing GPG signing. Normalize POM developer, organization, SCM, issue-management, distribution, and documentation metadata for the Android and Java packages. Verify the live artifact set before scheduling releases because live publication was not confirmed during the audit.

### Go, Swift, and CLI

Keep GitHub-derived coordinates. Improve repository descriptions, topics, social preview, README badges, release notes, signatures, and checksums without moving repositories or changing module URLs.

## Avatar design

The canonical source is:

`/Users/alexandrupuiu/development/Toggly/Toggly/src/Toggly.Web/ClientApp/src/assets/images/logo/favicon.png`

Create deterministic, non-generative outputs in the website repository:

- `toggly.io/public/brand/toggly-avatar-1024.png`
- `toggly.io/public/brand/toggly-gravatar-512.png`

Both outputs use a square `#556EE6` background, a centered white toggle-switch mark, 20% safe-area padding, transparent pixels removed, and no text or gradient. Verify the 512-pixel export at 32, 64, 128, and 256 pixels and with a circular crop. The Gravatar email must be a company-controlled shared address; do not record that email in the repository unless it is already public.

## External-action safety model

Every registry mutation follows the same gate:

1. Capture the current owners, package list, workflow identity, and recovery path from a fresh page.
2. Show the exact proposed additions and removals to the human operator.
3. Add company ownership or trusted publishing without removing the old path.
4. Verify read-only registry state.
5. Exercise the new path with a normal SemVer release only when a package change already warrants one.
6. Verify the live package owner, provenance, metadata, and install command.
7. Remove the superseded credential or personal owner.

Ownership removal, credential revocation, DNS verification, paid PyPI organization creation, and registry organization creation are external changes requiring explicit approval immediately before execution.

## Delivery slices and dependencies

```text
Programme governance and inventory
├── NuGet organization + avatar
│   └── NuGet trusted publishing + prefix reservation
├── npm organization + trusted publishing
├── PyPI organization + Python metadata
├── RubyGems owners + Ruby metadata
├── crates.io team + Rust metadata
├── pub.dev metadata
├── Packagist metadata and stable release
├── Maven Central organization + JVM metadata
└── GitHub-distributed Go, Swift, and CLI presentation
```

Each leaf is a separate Linear issue and PR slice. NuGet ownership must complete before NuGet trusted publishing. Other leaves can proceed independently after the governance inventory is approved.

## Linear structure

Parent issue: **OPS-724 — Professionalize Toggly package registry presence** — High

Child issues:

1. **OPS-725 — Move Toggly NuGet packages to the Toggly organization and publish the registry avatar** — High
2. **OPS-726 — Adopt NuGet trusted publishing and reserve the Toggly package prefix** — High; blocked by OPS-725
3. **OPS-727 — Standardize npm organization ownership, metadata, and trusted publishing** — Medium
4. **OPS-728 — Move Toggly Python packages into a PyPI organization and normalize metadata** — Medium; paid-organization approval required
5. **OPS-729 — Standardize RubyGems ownership, metadata, and trusted publishing** — Low
6. **OPS-730 — Standardize crates.io team ownership, metadata, and trusted publishing** — Medium
7. **OPS-731 — Polish pub.dev publisher metadata for all Toggly packages** — Low
8. **OPS-732 — Correct Packagist ownership metadata and publish a stable PHP release** — Medium
9. **OPS-733 — Place `io.toggly` under a Maven Central organization and normalize JVM metadata** — Medium
10. **OPS-734 — Polish GitHub-distributed Go, Swift, and CLI releases** — Low

All issues are assigned to the current user under the opsAI team and Toggly project with `Improvement` and `Technical` labels. They remain in Backlog until their execution slice starts.

## Acceptance criteria

- Existing consumer install commands remain valid.
- Only `Toggly.*` NuGet packages move; unrelated `opsai` packages remain untouched.
- Company-controlled ownership and two-person recovery exist on every registry.
- The approved avatar renders cleanly in Gravatar's circular crop and at 32 pixels.
- Public metadata conforms to the shared contract or documents a registry limitation.
- OIDC trusted publishing is used on NuGet, npm, pub.dev, PyPI, RubyGems, and crates.io after a verified transition.
- Persistent publish tokens are removed only after successful replacement publishes.
- Every published metadata change has a SemVer version bump and changelog entry.
- Source/local verification and live registry verification are reported separately.

## Reference documentation

- [NuGet organizations](https://learn.microsoft.com/en-us/nuget/nuget-org/organizations-on-nuget-org)
- [NuGet trusted publishing](https://learn.microsoft.com/en-us/nuget/nuget-org/trusted-publishing)
- [NuGet package ID prefix reservation](https://learn.microsoft.com/en-us/nuget/nuget-org/id-prefix-reservation)
- [npm organization scopes](https://docs.npmjs.com/about-organization-scopes-and-packages/)
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [Dart verified publishers and automated publishing](https://dart.dev/tools/pub/publishing)
- [PyPI organization project actions](https://docs.pypi.org/organization-accounts/actions/project-actions/)
- [RubyGems trusted publishing](https://guides.rubygems.org/trusted-publishing/adding-a-publisher/)
- [Cargo publishing and owners](https://doc.rust-lang.org/cargo/reference/publishing.html)
- [crates.io trusted publishing](https://blog.rust-lang.org/2025/07/11/crates-io-development-update-2025-07/)
- [Maven Central organizations](https://central.sonatype.org/publish/publish-portal-organizations/)
