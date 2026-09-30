# Toggly CLI

Command-line interface for Toggly feature flag management.

**Docs:** [https://docs.toggly.io/sdks/cli](https://docs.toggly.io/sdks/cli) — install, auth, command reference, and CI.

## Install

Package managers (installed binary is `toggly`; see full commands and trust
notes at [docs.toggly.io/sdks/cli/install](https://docs.toggly.io/sdks/cli/install)):

| Manager | Command |
|---------|---------|
| Homebrew | `brew install ops-ai/toggly/toggly-cli` |
| Scoop | `scoop bucket add toggly https://github.com/ops-ai/toggly-cli-dist && scoop install toggly/toggly-cli` |
| winget | `winget install Opsai.TogglyCLI` |
| Chocolatey | `choco install toggly-cli` |
| apt | see docs — flat repo published to `ops-ai/toggly-cli-dist` (`gh-pages`) |
| yum / dnf | see docs — same repo, `rpm/` path |

Package-manager availability depends on the [`cli-distribute.yml`](../.github/workflows/cli-distribute.yml)
workflow having the right ops secrets configured (see `packaging/README.md`);
until then, or as a manual fallback, download the archive for your platform
from the latest CLI GitHub Release ([`cli-v*`](https://github.com/ops-ai/Toggly.FeatureManagement/releases) tags):

| Platform | Release asset |
|----------|---------------|
| Windows x64 | `toggly-cli-windows-x64.zip` |
| Linux x64 | `toggly-cli-linux-x64.tar.gz` (includes `man/`) |
| Linux ARM64 | `toggly-cli-linux-arm64.tar.gz` (includes `man/`) |
| macOS Intel | `toggly-cli-macos-x64.tar.gz` |
| macOS Apple Silicon | `toggly-cli-macos-arm64.tar.gz` |

Extract and place `toggly-cli` (or `toggly-cli.exe`) on your `PATH`. On Linux, optional man pages are under `man/` in the archive (`man -l man/toggly.1`).

### Build from source

```bash
git clone https://github.com/ops-ai/Toggly.FeatureManagement.git
cd Toggly.FeatureManagement/Toggly.CLI
dotnet publish -c Release -r <RID> --self-contained -p:PublishSingleFile=true -p:PublishAot=true
```

`<RID>`: `win-x64`, `linux-x64`, `linux-arm64`, `osx-x64`, or `osx-arm64`.

## Quickstart

```bash
toggly-cli auth login
toggly-cli context set --app <app-id> --env Production
toggly-cli app list
toggly-cli --json feature list
```

CI client credentials: set `TOGGLY_CLIENT_ID` + `TOGGLY_CLIENT_SECRET` (or pass `--client-id` / `--client-secret`). Auth priority and exit codes are documented at [docs.toggly.io/sdks/cli](https://docs.toggly.io/sdks/cli).

## License

See the repository LICENSE file.
