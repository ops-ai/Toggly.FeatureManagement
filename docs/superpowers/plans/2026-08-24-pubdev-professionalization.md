# pub.dev Professionalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the verified `toggly.io` publisher while making all five Flutter package pages consistently complete and professional.

**Architecture:** Treat the existing verified publisher and OIDC workflow as the control plane. Normalize only manifest and README metadata, then release each provider according to the dependency order already encoded in the Flutter release workflow.

**Tech Stack:** Dart/Flutter pubspec, pub.dev verified publisher, GitHub Actions OIDC

**Spec:** `docs/plans/2026-08-24-package-registry-professionalization-design.md`

## Global Constraints

- Keep the five existing package names and the `toggly.io` verified publisher.
- Preserve the current OIDC publishing path.
- Use exact repository directories, SDK documentation, issue tracker, and `MIT` license.
- Every manifest metadata change requires a patch bump and package changelog entry.

---

### Task 1: Audit live publisher membership

**Files:**
- External: `https://pub.dev/publishers/toggly.io/packages`
- Read: `.github/workflows/sdk-flutter-release.yml`

- [ ] Record the five live packages, latest versions, repository, documentation, issue tracker, publisher, and automated-publishing identity.
- [ ] Compare the live set with the five workflow mappings and stop if either side has an extra or missing package.
- [ ] Verify at least two company-controlled members can administer the `toggly.io` publisher.

### Task 2: Normalize Flutter package metadata

**Files:**
- Modify: `Toggly.FeatureManagement.Flutter/toggly/pubspec.yaml`
- Modify: `Toggly.FeatureManagement.Flutter/toggly_disk/pubspec.yaml`
- Modify: `Toggly.FeatureManagement.Flutter/toggly_isar/pubspec.yaml`
- Modify: `Toggly.FeatureManagement.Flutter/toggly_secure_storage/pubspec.yaml`
- Modify: `Toggly.FeatureManagement.Flutter/toggly_sqlite/pubspec.yaml`
- Modify: the adjacent five `README.md` and `CHANGELOG.md` files

- [ ] Add a failing metadata check that requires `homepage`, `repository`, `issue_tracker`, `documentation`, `topics`, and `screenshots` only where a real maintained screenshot exists; repository values must include the exact monorepo directory.
- [ ] Run the check and capture all missing or stale fields.
- [ ] Normalize fields without changing package names, library APIs, dependency bounds, or SDK floors.
- [ ] Increment each changed package's patch version and add a changelog entry for registry metadata only.
- [ ] Run `flutter pub get`, `flutter analyze`, `flutter test`, and `dart pub publish --dry-run` in each changed package directory.
- [ ] Run Oracle and hosted PR checks, publish in the dependency order used by `.github/workflows/sdk-flutter-release.yml`, and verify the five fresh live pages.
