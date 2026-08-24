# RubyGems Professionalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Toggly's three gems company-controlled recovery ownership and consistent public metadata while keeping trusted publishing and gem names intact.

**Architecture:** Add a company-controlled named owner and retain one recovery owner per gem. Normalize the three gemspecs and release through the already configured RubyGems OIDC workflow.

**Tech Stack:** RubyGems, Bundler, gemspec, GitHub Actions trusted publishing

**Spec:** `docs/plans/2026-08-24-package-registry-professionalization-design.md`

## Global Constraints

- Keep `toggly`, `toggly-cache`, and `toggly-rails`.
- Use `Toggly`, `support@toggly.io`, exact monorepo source/changelog paths, exact SDK docs, and `MIT`.
- Retain at least one named recovery owner after company ownership is proven.
- Published metadata changes require patch versions and changelogs.

---

### Task 1: Normalize gem ownership

**Files:**
- External: the three RubyGems ownership pages

- [ ] Capture current owners, MFA state, trusted-publisher repository/workflow, and latest live versions.
- [ ] Present the company account to add and any personal owner proposed for later removal; obtain explicit approval.
- [ ] Add and verify the company owner on all three gems without removing existing owners.
- [ ] Confirm `.github/workflows/sdk-ruby-release.yml` remains the exact trusted publisher.

### Task 2: Normalize gem metadata and publish

**Files:**
- Modify: `toggly-ruby/toggly/toggly.gemspec`
- Modify: `toggly-ruby/toggly-cache/toggly-cache.gemspec`
- Modify: `toggly-ruby/toggly-rails/toggly-rails.gemspec`
- Modify: `toggly-ruby/toggly/CHANGELOG.md`
- Modify: `toggly-ruby/toggly-cache/CHANGELOG.md`
- Modify: `toggly-ruby/toggly-rails/CHANGELOG.md`
- Modify: adjacent `README.md` files where their public links conflict

- [ ] Add a failing gemspec contract test requiring `Toggly`, `support@toggly.io`, actual source/changelog URLs, exact documentation, `MIT`, descriptions, required Ruby version, and MFA requirement metadata.
- [ ] Confirm the test detects `Ops.ai`, `support@ops.ai`, and stale `ops-ai/toggly-ruby` URLs.
- [ ] Normalize the gemspecs without changing gem names, require paths, dependencies, or runtime behavior.
- [ ] Increment patch versions and add changelog entries.
- [ ] Run `bundle install`, the existing Rake test tasks, `gem build` for all three gemspecs, and inspect built gem metadata and file lists.
- [ ] Run Oracle and hosted checks, publish with the trusted workflow, verify fresh live pages and provenance, then remove only approved redundant owners while preserving recovery.
