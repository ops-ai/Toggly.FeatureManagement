# PyPI Professionalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put all five Python projects under company governance and correct their live metadata without changing project names.

**Architecture:** Keep the existing GitHub Actions trusted-publishing identity, optionally add the paid PyPI organization as project owner, and normalize all `pyproject.toml` files through one metadata contract and patch-release wave.

**Tech Stack:** PyPI organizations, PEP 621, Hatch/setuptools as currently configured, PyPA build, Twine, GitHub Actions OIDC

**Spec:** `docs/plans/2026-08-24-package-registry-professionalization-design.md`

## Global Constraints

- Keep `toggly`, `toggly-cache`, `toggly-django`, `toggly-fastapi`, and `toggly-flask`.
- Paid PyPI organization creation requires approval of the current `$5/member/month` corporate cost and exact member count.
- Preserve trusted publishing from `.github/workflows/sdk-python-release.yml`.
- Published metadata changes require patch versions and changelogs.

---

### Task 1: Establish PyPI organization ownership

**Files:**
- External: PyPI `Toggly` organization, organization teams, and five project owner pages

- [ ] Capture live owners, roles, versions, provenance, and trusted-publisher records for all five projects.
- [ ] Present the exact paid member count, monthly cost, two organization owners, publisher team, five project transfers, and individual role removals; obtain explicit approval.
- [ ] Create the organization, verify billing and recovery, transfer the five projects, and retain current owners during the overlap.
- [ ] Verify names, releases, install commands, downloads, and OIDC records are unchanged before removing any superseded individual owner.

### Task 2: Normalize Python metadata

**Files:**
- Modify: `Toggly.FeatureManagement.Python/toggly/pyproject.toml`
- Modify: `Toggly.FeatureManagement.Python/toggly-cache/pyproject.toml`
- Modify: `Toggly.FeatureManagement.Python/toggly-django/pyproject.toml`
- Modify: `Toggly.FeatureManagement.Python/toggly-fastapi/pyproject.toml`
- Modify: `Toggly.FeatureManagement.Python/toggly-flask/pyproject.toml`
- Modify or create: the five adjacent `README.md` and `CHANGELOG.md` files
- Modify: `.github/workflows/sdk-python-release.yml` only if its package inventory omits a project

- [ ] Add a failing test that parses all five manifests and requires exact author/maintainer, license, homepage, documentation, source, issue tracker, changelog, classifiers, and keywords.
- [ ] Confirm it detects the stale `ops-ai/toggly-sdks` links and missing project descriptions/readmes.
- [ ] Set source URLs to the actual monorepo with exact subdirectories and normalize the remaining public metadata without changing import names or dependency constraints.
- [ ] Add missing readmes/changelogs, bump patch versions, and document metadata/provenance changes.
- [ ] Build every distribution with `python -m build`, inspect with `twine check dist/*`, run each package's existing tests, and confirm wheels contain the expected modules and license.
- [ ] Run Oracle and hosted checks, publish through the existing trusted workflow, verify live project ownership/provenance/metadata, and then remove only explicitly approved superseded owners.
