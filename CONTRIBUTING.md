# Contributing

Thanks for your interest in improving the Toggly SDKs.

This repository is the official multi-platform SDK monorepo. We welcome well-scoped contributions, and we prefer to align on intent before code.

## Before you start

1. **Open an issue first** for bugs, features, or docs gaps — use the [issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
2. **Usage and how-to questions** belong in the [docs](https://docs.toggly.io) or product support, not in this repo.
3. **Security issues** must follow [`SECURITY.md`](SECURITY.md) (private vulnerability reporting only).

Please wait for maintainer feedback on the issue before opening a large PR.

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
