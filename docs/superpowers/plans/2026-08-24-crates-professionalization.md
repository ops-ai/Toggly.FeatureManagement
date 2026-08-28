# crates.io Professionalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put all five Rust crates under restricted Toggly team ownership, correct their metadata, and replace the persistent registry token with crates.io trusted publishing.

**Architecture:** Centralize public metadata in the Rust workspace, add a GitHub team as restricted crate owner plus one named recovery owner, then exchange GitHub OIDC for short-lived Cargo credentials in the existing ordered release workflow.

**Tech Stack:** Cargo workspace, crates.io owners, `rust-lang/crates-io-auth-action`, GitHub Actions OIDC

**Spec:** `docs/plans/2026-08-24-package-registry-professionalization-design.md`

## Global Constraints

- Keep the five crate names.
- Use GitHub team owner `github:ops-ai:toggly-sdk-maintainers` unless the human operator approves a different existing team.
- Preserve publish order and index-wait behavior in `.github/workflows/sdk-rust-release.yml`.
- Revoke `CARGO_REGISTRY_TOKEN` only after a trusted-publishing release succeeds.
- Published metadata changes require patch versions and changelog entries.

---

### Task 1: Add team and recovery ownership

**Files:**
- External: GitHub team and five crates.io owner lists

- [ ] Capture named/team owners, latest versions, and token/trusted-publisher state for all five crates.
- [ ] Present the exact GitHub team membership and crate owner additions; obtain explicit approval.
- [ ] Create or reuse the approved GitHub team, add it to each crate with `cargo owner --add github:ops-ai:toggly-sdk-maintainers <crate>`, and verify restricted team ownership plus one named recovery owner.

### Task 2: Normalize Rust metadata

**Files:**
- Modify: `toggly-rust/Cargo.toml`
- Modify: the five member `Cargo.toml` files
- Modify: `toggly-rust/README.md`
- Modify: `toggly-rust/CHANGELOG.md`

- [ ] Add a failing metadata test using `cargo metadata --no-deps --format-version 1` that requires Toggly author/support, actual repository URL, docs, homepage, license, README, description, keywords, and categories for every publishable crate.
- [ ] Confirm it detects `Ops.ai <contact@ops.ai>` and the stale repository URL.
- [ ] Normalize workspace inheritance and member-specific metadata without changing crate names, features, modules, or dependency API.
- [ ] Apply compatible patch versions across the interdependent crate graph and add an explicit changelog entry.
- [ ] Run `cargo fmt --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test --workspace --all-features`, and `cargo package --locked` for each crate in publish order.

### Task 3: Adopt crates.io trusted publishing

**Files:**
- Modify: `.github/workflows/sdk-rust-release.yml`
- Modify: `.github/RELEASE.md`

- [ ] Add a failing workflow test requiring `id-token: write`, `rust-lang/crates-io-auth-action@v1`, use of its temporary token, and absence of `secrets.CARGO_REGISTRY_TOKEN`.
- [ ] Configure the trusted publisher for repository `ops-ai/Toggly.FeatureManagement`, workflow `sdk-rust-release.yml`, and the exact release environment; obtain approval before saving it.
- [ ] Update authentication while preserving the existing crate order, duplicate checks, index waits, version handling, tests, tags, and release notes.
- [ ] Run local Rust verification, Oracle, and hosted PR checks; publish the patch wave and verify ownership, metadata, and trusted-publishing provenance on all five live pages.
- [ ] Obtain explicit approval and revoke the persistent crates.io token.
