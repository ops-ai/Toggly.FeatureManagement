# Maven Central Professionalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place the existing `io.toggly` namespace under a Toggly Central Portal organization and publish professional Android/Java POM metadata without changing coordinates.

**Architecture:** First determine the actual live artifact set and verified namespace owner. Add organization governance and portal-token publishing, then normalize Gradle Maven publications and Java parent/child POM metadata in independent Android and Java PRs.

**Tech Stack:** Maven Central Portal organizations, verified namespaces, Gradle Maven Publish, Maven POM, GPG signing, portal user tokens

**Spec:** `docs/plans/2026-08-24-package-registry-professionalization-design.md`

## Global Constraints

- Preserve `io.toggly` and every existing artifact ID.
- Do not claim a successful migration until live artifacts are confirmed; the initial audit did not confirm them.
- Keep GPG signing and use organization-scoped Central Portal user tokens.
- Published POM metadata changes require patch versions and changelog entries.

---

### Task 1: Verify and govern the Maven Central namespace

**Files:**
- External: Central Portal organization, `io.toggly` namespace, members, tokens, and live artifact search

- [ ] Search Central Portal for every Android and Java artifact ID declared in the repository and record live versions, namespaces, source links, and current organization.
- [ ] If no artifact is live, classify this as first publication rather than ownership migration and keep the existing coordinates.
- [ ] Present the exact organization, two administrators, namespace mapping, DNS verification record if requested, and portal token replacement; obtain explicit approval.
- [ ] Create or normalize the Toggly organization, map verified `io.toggly`, verify recovery access, and generate a least-privilege organization publishing token without revoking the old path.

### Task 2: Normalize Android publications

**Files:**
- Modify: `Toggly.FeatureManagement.Android/build.gradle.kts`
- Modify: the five module `build.gradle.kts` files
- Modify: `Toggly.FeatureManagement.Android/gradle.properties`
- Modify: `Toggly.FeatureManagement.Android/README.md`
- Modify: `Toggly.FeatureManagement.Android/CHANGELOG.md`
- Modify: `.github/workflows/sdk-android-release.yml`

- [ ] Add a failing Gradle publication test that generates every POM and requires name, description, URL, `Toggly` organization/developer, `support@toggly.io`, `MIT`, exact SCM connection/tag, issue management, and documentation.
- [ ] Normalize shared POM metadata without changing group, artifact IDs, Android namespaces, dependencies, or API.
- [ ] Increment compatible patch versions and add a changelog entry.
- [ ] Run `./gradlew clean test lint publishToMavenLocal` and inspect all generated POMs, source JARs, Javadoc/Dokka JARs, signatures, and checksums.
- [ ] Update the workflow to use the organization portal token secret names while preserving GPG signing and release gates.

### Task 3: Normalize Java publications

**Files:**
- Modify: `Toggly.FeatureManagement.Java/pom.xml`
- Modify: the seven child `pom.xml` files
- Modify: `Toggly.FeatureManagement.Java/README.md`
- Modify: `Toggly.FeatureManagement.Java/CHANGELOG.md`
- Create or modify: the Java release workflow selected after live-publication discovery

- [ ] Add a failing effective-POM test requiring the same organization, developer, license, SCM, issues, docs, sources, Javadocs, signing, and Central Portal publishing fields as Android.
- [ ] Normalize parent inheritance and child-specific descriptions without changing coordinates, Java floor, packages, dependencies, or API.
- [ ] Increment compatible patch versions and add a changelog entry.
- [ ] Run `mvn -B clean verify`, generate effective POMs, and inspect source/Javadoc JARs, signatures, and checksums.

### Task 4: Prove live Central publication

- [ ] Run Oracle independently for Android and Java PR heads and require hosted green checks.
- [ ] Publish one normal patch wave per stack through the organization token.
- [ ] Verify every selected coordinate, POM field, signature, source/Javadoc artifact, install snippet, and organization/namespace mapping from fresh Central pages.
- [ ] Obtain explicit approval and revoke superseded Central credentials only after both required stacks have proven the new path.
