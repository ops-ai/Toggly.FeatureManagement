# Toggly CLI package-manager distribution (Wave 5, OPS-1580)

GitHub `cli-v*` Releases (built by [`cli-build-release.yml`](../../.github/workflows/cli-build-release.yml))
remain the **single source of truth** for CLI binaries: multi-RID AOT
archives, `SHA256SUMS`, and a GPG-signed `SHA256SUMS.asc`. Everything in this
directory only *consumes* those assets — nothing here rebuilds a binary or
touches the GitHub Release.

[`.github/workflows/cli-distribute.yml`](../../.github/workflows/cli-distribute.yml)
runs after a `cli-v*` release is published (or via manual
`workflow_dispatch` with a `tag` input) and updates each channel below
independently. Every channel job is `continue-on-error: true` — one
channel failing (or an ops secret being missing) never fails another
channel and never rolls back the Release.

## Channel map

| Channel | Destination | Install command (once wired) |
| --- | --- | --- |
| Homebrew | `ops-ai/toggly-cli-dist` repo, `main` branch, `Formula/toggly-cli.rb` | `brew tap ops-ai/toggly-cli-dist https://github.com/ops-ai/toggly-cli-dist`<br>`brew install toggly-cli` |
| Scoop | `ops-ai/toggly-cli-dist` repo, `main` branch, `toggly-cli.json` (repo root) | `scoop bucket add toggly https://github.com/ops-ai/toggly-cli-dist`<br>`scoop install toggly/toggly-cli` |
| apt | `ops-ai/toggly-cli-dist` repo, `gh-pages` branch, `apt/` (flat repo) | `echo 'deb [trusted=yes] https://ops-ai.github.io/toggly-cli-dist/apt ./' \| sudo tee /etc/apt/sources.list.d/toggly-cli.list`<br>`sudo apt-get update && sudo apt-get install toggly-cli` |
| yum / dnf | `ops-ai/toggly-cli-dist` repo, `gh-pages` branch, `rpm/` (createrepo_c repodata) | add a `.repo` file with `baseurl=https://ops-ai.github.io/toggly-cli-dist/rpm/` (see docs install page) |
| winget | PR to `microsoft/winget-pkgs`, package id `Opsai.TogglyCLI` (manifests rendered under `packaging/winget/`) | `winget install Opsai.TogglyCLI` (after the PR merges) |
| Chocolatey | community feed, package id `toggly-cli` | `choco install toggly-cli` |

**Important — `ops-ai/toggly-cli-dist` does not use the `homebrew-*` repo
naming convention.** Homebrew's `brew tap <user>/<name>` shorthand expects a
remote repo literally named `homebrew-<name>`; without that prefix it will
try to clone a repo that does not exist. Always pass the explicit clone URL
when tapping this repo (`brew tap ops-ai/toggly-cli-dist
https://github.com/ops-ai/toggly-cli-dist`), both in docs and in this
workflow's own smoke-test step.

One repo, three channel types — no `homebrew-toggly` / `scoop-toggly` /
`toggly-cli-packages` sibling repos. (An earlier draft of this wave used
three separate repos; that decision was reversed before shipping — see the
Linear issue history on OPS-1580 if you find stale references.)

## Secrets (ops, one-time)

| Secret | Used by | Notes |
| --- | --- | --- |
| `CLI_DIST_TOKEN` | homebrew, scoop, apt-rpm jobs | Fine-grained PAT with **contents: write** on `ops-ai/toggly-cli-dist` only. Falls back to `RELEASE_PUSH_TOKEN` if that token already has push access to `toggly-cli-dist` — prefer a dedicated `CLI_DIST_TOKEN` scoped to just that repo instead of widening `RELEASE_PUSH_TOKEN`'s reach. |
| `WINGET_TOKEN` | winget job | Optional. Classic PAT with `public_repo` scope, used by `wingetcreate` to open a PR against `microsoft/winget-pkgs`. Without it, the job renders manifests and uploads them as a workflow artifact for manual submission instead of failing. |
| `CHOCO_API_KEY` | chocolatey job | Optional. Chocolatey Community Repository API key. Without it, the job still packs the `.nupkg` and runs a local install smoke test — it just skips the `choco push`. |
| `GPG_PRIVATE_KEY` / `GPG_PASSPHRASE` | homebrew, scoop, apt-rpm jobs | Already exist as repo secrets (reused from `cli-build-release.yml`). **Required**, not optional: `ops-ai`'s org-wide "Branch security" ruleset rejects unsigned commits on every branch of every repo, so every push to `toggly-cli-dist` (`main` for Homebrew/Scoop, `gh-pages` for apt/rpm) must be GPG-signed the same way release commits already are. |

A single `CLI_DIST_TOKEN` replaces the three separate tap/bucket/packages
tokens an earlier draft of this plan called for — one repo, one secret.

### One-time ops checklist

1. Confirm `ops-ai/toggly-cli-dist` exists (public) with `main` as the
   default branch. `gh-pages` is created automatically by the `apt-rpm` job
   the first time it publishes (orphan branch).
2. Enable **GitHub Pages** on `ops-ai/toggly-cli-dist` → Settings → Pages →
   source: `gh-pages` branch, `/` root. (The workflow pushes to the branch;
   it cannot enable Pages itself without repo-admin scope on the token.)
3. Add `CLI_DIST_TOKEN` as an Actions secret on
   `ops-ai/Toggly.FeatureManagement` (fine-grained PAT, `contents: write`
   scoped to `ops-ai/toggly-cli-dist`).
4. Optional: add `WINGET_TOKEN` / `CHOCO_API_KEY` for those two channels.
5. First real distribute run: `workflow_dispatch` on `cli-distribute.yml`
   against the latest `cli-v*` tag after this PR merges and a `0.4.0`
   release is cut.

If secrets or the sibling repo are missing, every affected job step prints
a clear `::warning::` and the job still completes (skip, not silent
success) — see the workflow run summary for a per-channel status table.

## Local smoke

Render every channel's recipe against an already-published tag (no secrets
required — this only reads public release assets):

```bash
./Toggly.CLI/packaging/scripts/render-templates.sh cli-v0.3.2
# -> Toggly.CLI/packaging/dist/0.3.2/{homebrew,scoop,winget,chocolatey,nfpm}/...
```

Generic post-install version check (used by every channel's smoke step in
CI):

```bash
./Toggly.CLI/packaging/scripts/smoke-channel.sh 0.4.0        # expects `toggly` on PATH
./Toggly.CLI/packaging/scripts/smoke-channel.sh 0.4.0 toggly-cli   # archive-only installs
```

### Manual Homebrew smoke (macOS/Linux with brew)

```bash
./Toggly.CLI/packaging/scripts/render-templates.sh cli-v0.3.2 /tmp/dist
brew tap ops-ai/toggly-cli-dist /tmp/dist/homebrew   # or the real GitHub URL once pushed
# if using the rendered file directly instead of a tap:
brew install --formula /tmp/dist/homebrew/Formula/toggly-cli.rb
```

### Manual nfpm smoke (Linux, or macOS with `go install`)

```bash
go install github.com/goreleaser/nfpm/v2/cmd/nfpm@v2.47.0
./Toggly.CLI/packaging/scripts/render-templates.sh cli-v0.3.2 /tmp/dist
mkdir -p /tmp/dist/nfpm/payload
tar -xzf <(curl -fsSL https://github.com/ops-ai/Toggly.FeatureManagement/releases/download/cli-v0.3.2/toggly-cli-linux-x64.tar.gz) -C /tmp/dist/nfpm/payload
cd /tmp/dist/nfpm && nfpm package --config toggly-cli-amd64.yaml --packager deb --target /tmp/toggly-cli.deb
```

## File map

| Path | Responsibility |
| --- | --- |
| `homebrew/toggly-cli.rb.tmpl` | Homebrew formula template; installs binary as `toggly`, man pages when present |
| `scoop/toggly-cli.json.tmpl` | Scoop manifest template; renames shim to `toggly` |
| `winget/*.tmpl` | winget multi-file manifest templates (version / installer / `en-US` locale), portable install type, `toggly` alias |
| `chocolatey/toggly-cli.nuspec.tmpl` + `chocolatey/tools/*.ps1.tmpl` | Chocolatey package; renames extracted exe to `toggly.exe` so the generated shim is `toggly` |
| `nfpm/toggly-cli.yaml.tmpl` | nfpm config for `.deb` / `.rpm`; installs binary at `/usr/bin/toggly` + man pages under `/usr/share/man/man1/` |
| `scripts/render-templates.sh` | Fetches `SHA256SUMS` for a tag, renders every template above |
| `scripts/smoke-channel.sh` | Generic `<bin> --version` assertion used by every channel's CI smoke step |

## Residual risks / known gaps

- **apt/rpm trust model:** v1 publishes an **unsigned** flat repo
  (`[trusted=yes]` in the apt source line). GPG-signing the `Release`/
  `Packages` file with the existing release key is a reasonable follow-up
  but out of scope for the initial wire-up — document this clearly on the
  docs install page.
- **winget without `WINGET_TOKEN`:** manifests are still rendered and
  uploaded as a build artifact each run so a human can submit them via
  `wingetcreate` manually; the job does not silently do nothing.
- **Chocolatey without `CHOCO_API_KEY`:** the package is still packed and
  smoke-tested by installing the local `.nupkg` directly, so a broken
  template still fails the job even though nothing is published.
- **GitHub Pages enablement** requires repo-admin UI access (or an
  API call with `administration: write`); the workflow's fine-grained PAT
  is scoped to `contents: write` only, so a human must flip the Pages
  toggle once per the ops checklist above.
