# Elixir Sonar analysis preparation

Tracked by [OPS-1493](https://linear.app/opsai/issue/OPS-1493). This workspace
exports generic coverage for `toggly`, `toggly_phoenix` and `toggly_live_view`.
The reports are preparation artifacts. The native workflow does **not** run a
Sonar scanner or assert a hosted quality-gate verdict.

## Analyzer availability (2026-09-28)

Neither the official [Server language matrix][server-languages] nor the
[Cloud language overview][cloud-languages] lists Elixir. Generic coverage XML
alone does not make an unsupported language analyzable. Do not relabel Elixir
files as another language or interpret an empty issue search as zero findings.

The programme coordinator inspected the authenticated Server administration UI:
SonarQube Community Build **26.4.0.121862**, Community Branch Plugin **26.4.0**,
and no Elixir analyzer in the installed plugin inventory. Authenticated project
search for `elixir` returned no matching project. This is evidence of missing
analysis infrastructure, not an inventory of Elixir code findings.

The community [hpopp/sonar-elixir][elixir-plugin] has an MIT-licensed **v0.1.1**
release (2026-03-08). Its README labels it early development, claims compatibility
with SonarQube 2025.1+ and requires Elixir on the scanner host for parsing. Its
release POM targets Java 17 and Sonar plugin API 11.0.0.2664. These declarations
do not prove compatibility with this server, OTP 29, or Elixir 1.20.4. Its rule
set is small and must not be represented as native SonarSource Elixir support.

Installing this plugin is a shared-server change. Sonar's [installation guide]
requires administrator acceptance of third-party-plugin risk, installation, and
a restart. No installation, restart, project creation, token creation, or quality
profile change is part of this repository preparation. Native Server branch/PR
analysis is a commercial feature starting in Developer Edition; this Community
Build uses a third-party branch plugin, whose interoperability with the Elixir
analyzer remains to be tested. See [Sonar's branch documentation][branches].

## Generate reports and enforce native gates

From `toggly-elixir`, with the committed runtime floor Elixir 1.20.4 / OTP 29:

```sh
mix deps.get --check-locked
mix hex.audit
mix format --check-formatted
mix compile --warnings-as-errors
elixir tools/sonar_coverage_test.exs
mix test --cover --export-coverage sonar
mix cmd mix test.coverage
elixir -r tools/sonar_coverage.ex -e 'Toggly.SonarCoverage.run()'
python3 tools/build-packages.py
```

`--export-coverage` bypasses Mix's normal threshold check. The following
`mix cmd mix test.coverage` is mandatory: it checks each child's unchanged
**91%** threshold instead of applying an umbrella average. See [Mix coverage].

The exporter imports only each package's `cover/sonar.coverdata`, maps modules
to existing package library files using the matching compiled BEAM metadata,
and fails if the export omits a compiled module. It emits
`apps/<package>/cover/sonar-coverage.xml`; all file paths are relative to the
`toggly-elixir` scanner base directory. Generated line zero is omitted, as in
Mix. Multiple modules on one source line are combined with logical OR. These
are executable **line** measurements; no branch coverage is inferred.

The native analysis artifact contains all three coverage directories and Hex
tarballs. XML can be validated locally without claiming that Sonar imported it.
The lock update to Mint 1.11.0 and its required HPAX 1.1.0 clears the Mint
advisories published on 2026-09-28 for this workspace. A lockfile change does not
raise the dependency minimums in packages already published to Hex.

## Activation decision and acceptance

Before enabling a hosted job, the administrator and independent reviewer must:

1. Validate the selected pinned analyzer in an isolated instance matching the
   current server and branch plugin. Check parser failures are visible failures,
   rules actually report a deliberate fixture defect, clean input clears it,
   and the full Elixir 1.20.4 source is recognized. Review provenance/license and
   the concrete installation/restart change before applying it to the shared
   instance. No claim of broad security analysis follows from this rule set.
2. Provision `toggly-sdks-elixir` with the intended `develop` main branch, GitHub
   repository binding, chosen active Elixir quality profile, existing programme
   quality gate, and access for the existing `SONAR_SERVER_TOKEN`. Reuse existing
   secret storage (`SONAR_HOST_URL` / `SONAR_SERVER_TOKEN`); do not commit tokens.
3. Enable a required Server scan after successful native gates and report export.
   Use `SonarSource/sonarqube-scan-action` with `projectBaseDir: toggly-elixir` and
   the committed properties. Set up Elixir in that job because the community
   analyzer invokes it. Check out the exact PR **head SHA** with full history,
   fetch its base, and pass `sonar.scm.revision=<head SHA>`. For PRs set
   `sonar.pullrequest.key=<number>`, `.branch=<head ref>`, `.base=<base ref>`;
   do not also pass `sonar.branch.name`. For the develop baseline pass
   `sonar.branch.name=develop` and its exact revision instead. Do not analyze a
   synthetic GitHub merge ref as the PR head. Handle fork secrets as an explicit
   unavailable check without exposing them to untrusted code.
4. Retain `sonar.qualitygate.wait=true` and its timeout. Do not use
   `continue-on-error`, optional-success fallbacks or missing-report tolerance.
   Authenticate a pre-scan capability check for the expected analyzer, active
   rules/profile and project. Missing infrastructure must fail that required
   check. Run the scan for Elixir PR changes and fresh develop changes, respecting
   the shared `run_reporting` caller contract without reporting skipped analysis
   as a gate pass.
5. Prove one failed gate propagates to failed CI, then independently inspect the
   successful exact-head analysis: compute-engine task completed, revision
   matches, gate evaluated, Elixir source-file count is nonzero, and all three
   coverage roots have real measures. Compare package coverage with the native
   reports; investigate any disagreement. Inventory develop findings only after
   this real baseline. Preserve the analysis ID and revision with the evidence.

Until these checks pass, OPS-1493's hosted analysis remains blocked. There is no
Cloud Elixir gate and no Server Elixir gate to call green.

[server-languages]: https://docs.sonarsource.com/sonarqube-server/analyzing-source-code/languages/overview
[cloud-languages]: https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/languages/overview
[elixir-plugin]: https://github.com/hpopp/sonar-elixir/tree/v0.1.1
[installation guide]: https://docs.sonarsource.com/sonarqube-server/server-installation/plugins/install-a-plugin
[branches]: https://docs.sonarsource.com/sonarqube-server/2025.1/analyzing-source-code/branch-analysis/setting-up-the-branch-analysis
[Mix coverage]: https://mix.hexdocs.pm/Mix.Tasks.Test.Coverage.html
