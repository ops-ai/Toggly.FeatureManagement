# Toggly Package Registry Programme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver company-controlled, professional Toggly package registry profiles without changing any public package coordinate.

**Architecture:** Treat each registry as an independent issue/PR slice governed by one compatibility and metadata contract. External ownership transitions use additive overlap, fresh live verification, a real release on the new authentication path, and delayed removal of the old owner or credential.

**Tech Stack:** NuGet, npm, pub.dev, PyPI, RubyGems, crates.io, Packagist, Maven Central, GitHub Actions, Gravatar, GitHub Releases

**Spec:** `docs/plans/2026-08-24-package-registry-professionalization-design.md`

## Global Constraints

- Preserve every existing package coordinate and install command.
- Transfer only `Toggly.*` packages from the NuGet `opsai` profile.
- Use `Toggly`, `support@toggly.io`, `https://toggly.io`, exact SDK documentation links, actual source repositories, GitHub Issues, and `MIT` wherever supported.
- Keep a working owner and publishing path until the replacement has passed a real release and live verification.
- Every published metadata change requires a SemVer version bump and changelog entry.
- Never place registry tokens, Gravatar credentials, signing material, or private email addresses in the repository.
- Treat organization creation, paid subscriptions, ownership removal, token revocation, and DNS verification as explicit human gates.
- Run the Toggly Oracle before any readiness claim; hosted gates must pass on the exact PR head.

---

## Programme files

- External-action runbook: `docs/plans/2026-08-24-package-registry-external-action-checklist.md`
- NuGet and avatar: `docs/superpowers/plans/2026-08-24-nuget-organization-and-avatar.md`
- npm: `docs/superpowers/plans/2026-08-24-npm-professionalization.md`
- pub.dev: `docs/superpowers/plans/2026-08-24-pubdev-professionalization.md`
- PyPI: `docs/superpowers/plans/2026-08-24-pypi-professionalization.md`
- RubyGems: `docs/superpowers/plans/2026-08-24-rubygems-professionalization.md`
- crates.io: `docs/superpowers/plans/2026-08-24-crates-professionalization.md`
- Packagist: `docs/superpowers/plans/2026-08-24-packagist-professionalization.md`
- Maven Central: `docs/superpowers/plans/2026-08-24-maven-central-professionalization.md`
- GitHub-distributed SDKs: `docs/superpowers/plans/2026-08-24-github-distributed-sdk-professionalization.md`

## Programme order

- [x] **Step 1: Create the approved Linear programme and child issues**

Created parent `OPS-724` and children `OPS-725` through `OPS-734` exactly as named in the spec. `OPS-726` is blocked by `OPS-725`; all issues are assigned to the current user under opsAI/Toggly with verified priorities and labels. Delivery branches and PRs use their child issue keys.

- [ ] **Step 2: Capture a read-only registry inventory**

For every coordinate in the spec, record the live URL, owners, latest stable version, public publisher name, source URL, documentation URL, support contact, provenance state, and publishing workflow. Store no secrets. Compare the live set to `.github/RELEASE.md` and the workflow matrices.

- [ ] **Step 3: Approve the external-action envelope**

Present the exact organizations, owners to add, owners to remove later, paid PyPI member count, GitHub teams, DNS records, trusted-publisher repository/workflow pairs, and credentials to revoke. Stop until the human operator explicitly approves those mutations.

- [ ] **Step 4: Execute independent registry plans**

Dispatch one execution thread per child issue. NuGet organization/avatar precedes NuGet trusted publishing; all other registry plans may run independently. Each thread owns its issue branch and draft PR and stops at its documented external gates.

- [ ] **Step 5: Verify each slice independently**

Require manifest validation, pack/dry-run inspection, ecosystem tests, changelog/version checks, Oracle `pass`, hosted PR gates on the exact head, and fresh live registry verification after publication. A source-only check is not live proof.

- [ ] **Step 6: Close the programme with a compatibility audit**

Run every installation example from `.github/RELEASE.md` and the root `README.md` against the final live versions. Confirm that no coordinate changed, no unrelated NuGet owner changed, all superseded tokens were revoked only after successful OIDC publication, and recovery ownership remains in place.

- [ ] **Step 7: Commit the programme closeout**

```bash
git add docs/plans/2026-08-24-package-registry-professionalization-design.md docs/plans/2026-08-24-package-registry-external-action-checklist.md docs/superpowers/plans
git diff --cached --name-only
git commit -F - <<'EOF'
Document Toggly package registry programme [OPS-724]

Define the compatibility contract, registry-specific delivery slices, and
human-controlled ownership and credential transitions for Toggly packages.

Linear Issues:
- OPS-724: Professionalize Toggly package registry presence
EOF
```

Expected staged paths: only the approved design and programme plan documents.
