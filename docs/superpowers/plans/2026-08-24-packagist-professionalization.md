# Packagist Professionalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the public `toggly/feature-management-php` presentation and establish resilient maintainer ownership without changing its Composer coordinate.

**Architecture:** The standalone PHP repository remains authoritative. Fix its Composer metadata and release pipeline, verify the Packagist GitHub integration, and publish a stable SemVer tag that updates the existing package page.

**Tech Stack:** Composer, Packagist, PHPUnit, GitHub Releases

**Spec:** `docs/plans/2026-08-24-package-registry-professionalization-design.md`

## Global Constraints

- Keep `toggly/feature-management-php` and the existing GitHub repository URL.
- Replace the live `support.woop@toggly.io` typo with `support@toggly.io`.
- Add a second company-controlled maintainer before removing or reducing any current maintainer.
- A metadata change requires a stable SemVer release and changelog entry.

---

### Task 1: Correct PHP package metadata

**Files:**
- Modify: `/Users/alexandrupuiu/development/Toggly/Toggly.FeatureManagement.PHP/composer.json`
- Modify: `/Users/alexandrupuiu/development/Toggly/Toggly.FeatureManagement.PHP/README.md`
- Modify: `/Users/alexandrupuiu/development/Toggly/Toggly.FeatureManagement.PHP/CHANGELOG.md`
- Modify: `/Users/alexandrupuiu/development/Toggly/Toggly.FeatureManagement.PHP/.github/workflows/release.yml` only if its live-tag contract is incomplete

- [ ] Create an isolated issue branch from the standalone repository's current default branch and preserve unrelated worktree changes.
- [ ] Add a failing metadata assertion requiring exact package name, `Toggly`, `support@toggly.io`, homepage, exact source/support URLs, `MIT`, description, and feature-management keywords.
- [ ] Normalize `composer.json` and README links without changing package name, PHP floor, namespaces, dependencies, or APIs.
- [ ] Increment the patch version according to the standalone release contract and add a changelog entry for package-page metadata only.
- [ ] Run `composer validate --strict`, `composer install --prefer-dist --no-progress`, and `vendor/bin/phpunit`; inspect `composer show --self` output.
- [ ] Run Oracle and hosted PR checks on the exact head.

### Task 2: Normalize Packagist maintainers and release

**Files:**
- External: Packagist package maintainers and GitHub integration/webhook

- [ ] Capture the live maintainers, source URL, auto-update status, versions, and support email.
- [ ] Present the exact maintainer addition and any later removal; obtain explicit approval.
- [ ] Add the second company-controlled maintainer and verify recovery access.
- [ ] Verify or repair the GitHub service/webhook so the existing Packagist package follows signed stable tags from `ops-ai/Toggly.FeatureManagement.PHP`.
- [ ] Merge the verified PR, create the normal signed stable tag, and verify Packagist displays the new version, corrected support email, source, license, and README.
- [ ] Remove only explicitly approved redundant maintainers after fresh live verification.
