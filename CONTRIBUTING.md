# Contributing

Thanks for your interest in improving the Toggly SDKs.

This repository is the official multi-platform SDK monorepo. We welcome well-scoped contributions, and we prefer to align on intent before code.

## Before you start

1. **Open an issue first** for bugs, features, or docs gaps — use the [issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
2. **Usage and how-to questions** belong in the [docs](https://docs.toggly.io) or product support, not in this repo.
3. **Security issues** must follow [`SECURITY.md`](SECURITY.md) (private vulnerability reporting only).

Please wait for maintainer feedback on the issue before opening a large PR.

## Support floors (canonical minima)

Documented runtime floors must match package metadata and CI. Prefer raising docs to what we enforce over promising older versions we do not test.

| SDK | Minimum | Source of truth |
|-----|---------|-----------------|
| Java | Java **17+**; Spring Boot **3.2+** for Spring modules | `Toggly.FeatureManagement.Java/pom.xml`, analysis-java JDK 17/21 |
| Rust | Rust **1.88+** (MSRV) | `toggly-rust/Cargo.toml` `rust-version`, analysis-rust MSRV job |
| Go | Go **1.24+** | `toggly-go/go.mod`, analysis-go |
| Ruby | Ruby **3.2+**; Rails **7.0+** | gemspecs; analysis-ruby + sdk-ruby-release matrices |
| Python | Python **3.8+** (FastAPI package **3.9+**) | `pyproject.toml`; analysis-python + sdk-python-release |
| Node / Next / Nuxt / Remix | Node **18+** | `engines.node`; analysis matrices 18/20/22 |
| Android | API **24+**, Java **17+** | README + `minSdk` / AGP toolchain |
| iOS | iOS **14+**, Swift **5.5+**, Xcode **15+** | iOS README |

Dependabot and dependency PRs must stay inside these floors. Framework majors (Next 16, Nuxt 4, Spring Boot 4, AGP 9, etc.) are product decisions — see `.github/dependabot.yml`.

Angular peers are **15+** (CI builds against the monorepo Angular version). .NET multi-TFM packages are built for listed targets; automated tests run on **net9.0**.

## Pull requests

- Keep changes focused on one package or concern.
- Link the related issue in the PR description.
- Add or update tests when changing SDK behavior.
- If you change a **publishable package**, bump its version and update its `CHANGELOG.md` in the same PR. See [`.github/RELEASE.md`](.github/RELEASE.md).
- Do not commit secrets, credentials, or machine-local config.

## Code of conduct

Participation is governed by our [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the same license as the package you modify (MIT for most SDKs in this repo).
