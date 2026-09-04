# SDK support matrix alignment — design

**Linear**: [OPS-858](https://linear.app/opsai/issue/OPS-858/align-sdk-support-claims-with-build-metadata-and-ci-matrices)  
**Repo**: `ops-ai/Toggly.FeatureManagement`  
**Mode**: Medium  
**Related**: Dependabot policy OPS-693 (`.github/dependabot.yml`)

## Goal

Make every published support claim match what we compile against and what CI proves. Prefer raising docs/metadata to current enforcement over promising older floors we do not test.

## Decision rule

| Signal | Action |
|--------|--------|
| README/package floor **lower** than compiler/`go`/`rust-version` | Raise docs (and package metadata if needed) to the enforced floor |
| Documented floor **higher** than CI matrix | Either add CI versions or lower the claim to the lowest CI-proven version |
| Peer/compatibility range with no multi-version CI | Document as **peer-compatible / tested on X**, not “Full support for every major” |

## Phase 1 — Hard mismatches (do first)

No product choice: docs are wrong relative to build metadata.

### Java

- Update `Toggly.FeatureManagement.Java/README.md` Requirements: **Java 17+** (drop 11+).
- Keep Spring Boot claim honest: either **Spring Boot 3.2+** (matches current `pom.xml` pin) or “3.x peer-compatible; CI tests against 3.2.x”. Prefer **3.2+** until a Boot matrix exists.
- No `pom.xml` change in this phase (already `java.version=17`).

### Rust

- Update `toggly-rust/README.md` Requirements: **Rust 1.88+ (MSRV)** (drop 1.70+).
- Fix `.github/workflows/analysis-rust.yml`:
  - MSRV job step name: “Install Rust 1.88” (not 1.85).
  - Job summary: MSRV **1.88** (not 1.85).
- Leave `Cargo.toml` `rust-version = "1.88"` as source of truth.

### Go

- Update `toggly-go/README.md` install blurb: **Go 1.24+** (drop 1.22+).
- Leave `go.mod` `go 1.24.0` as source of truth.

## Phase 2 — Soft mismatches (choose one option per SDK)

### Ruby (recommended: widen CI)

**Keep** gemspec/README `>= 3.0.0` and align matrices:

| Workflow | Today | Target |
|----------|-------|--------|
| `analysis-ruby.yml` | 3.2, 3.3, 3.4 | Add **3.0, 3.1** (keep 3.4) |
| `sdk-ruby-release.yml` | 3.0–3.3 | Add **3.4** |

**Alternative**: raise to `>= 3.2.0` and drop 3.0/3.1 from release CI — only if we intentionally end 3.0/3.1 support.

### Python (recommended: widen release CI)

**Keep** `requires-python = ">=3.8"` and add **3.8** to `sdk-python-release.yml` matrix (analysis already has 3.8–3.13).

**Alternative**: raise package floors to `>=3.9` if 3.8 cost is not worth it.

### Spring Boot / Angular / .NET (docs-only follow-up)

- Java README: “tested against Spring Boot 3.2.x / Spring Framework 6.1+ in CI”.
- Angular: change “Full” table wording to peer range + “CI builds against Angular N”.
- .NET: note multi-TFM packages are **built** for listed TFMs; automated tests run on **net9.0**.

Out of scope for Phase 1/2: multi-Angular or per-TFM .NET test matrices.

## Phase 3 — Living matrix note

Add a short “Support floors” section to FeatureManagement `CONTRIBUTING.md` (or a one-pager under `docs/`) listing canonical minima for agents and Dependabot reviewers. Point Dependabot ignore rules at the same floors.

## Explicit non-goals

- Merging open Dependabot PRs.
- Lowering Java 17 / Rust 1.88 / Go 1.24 back to older floors.
- One mega dependency upgrade PR.

## Implementation order

1. Phase 1 doc + Rust workflow string fixes (single PR).
2. Phase 2 Ruby/Python CI or floor changes (same PR or follow-up if matrix expands are noisy).
3. Phase 3 CONTRIBUTING / support note.
4. Then resume Dependabot wave with floors as gate.

## Verification

- Grep READMEs for stale “11+”, “1.70”, “1.22”, “1.85”.
- Confirm Ruby/Python analysis + release matrices include every documented floor.
- Rust MSRV job name and summary match `rust-version`.

## Open decisions — approved 2026-09-03; Ruby adjusted after CI

1. **Ruby**: initially widen CI to 3.0–3.4; CI failed because lockfile Bundler 2.7.2 requires Ruby ≥ 3.2. **Raised floor to 3.2+** (gemspecs, README, CI matrices).
2. **Python**: keep 3.8+; add 3.8 to release CI.
3. **Spring Boot README**: document **3.2+** (matches pom pin).
