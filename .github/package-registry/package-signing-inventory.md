# Package signing inventory (OPS-1411)

Recorded: 2026-09-24

Companion docs:

- [nuget-signing-status.md](nuget-signing-status.md) — NuGet Key Vault
  signing and Authenticode gate
- [npm-governance-status.md](npm-governance-status.md) — npm org and
  Trusted Publisher human gates
- [npm-packages.json](npm-packages.json) — per-package `oidcReady`

## Summary

| Ecosystem | Artifacts | Crypto / provenance | Status |
|-----------|-----------|---------------------|--------|
| NuGet | 18 `Toggly.*` packages (`sdk-dotnet-release.yml`) | Azure Key Vault `NuGetKeyVaultSignTool` on `*.nupkg` + `*.snupkg` | **Signed** |
| NuGet / CLI release assets | GitHub Release `SHA256SUMS` + `.asc` | GPG-signed checksums | **Signed** |
| Authenticode | DLLs / Windows `toggly-cli.exe` | Not enabled | **Gated** — needs Code Signing EKU on `NUGET_SIGN_CERTIFICATE` |
| npm `@ops-ai/*` | 40 inventoried packages | OIDC Trusted Publisher + `--provenance` | **Ready** — all inventoried packages `oidcReady: true` |
| Maven Central (Java / Android) | Java + Android SDKs | GPG-signed artifacts | **Signed** |
| PyPI | Python packages | Trusted publishing / OIDC attestations | **Acceptable** |
| RubyGems | Ruby gems | Trusted publishing | **Acceptable** |
| crates.io | Rust crates | OIDC (soft token fallback on main rust workflow) | **Acceptable** |
| pub.dev | Flutter | OIDC automated publishing | **Acceptable** |
| Hex.pm | Elixir | `HEX_API_KEY` secret | **Auth hygiene gap** (not package crypto) |
| Go / PHP / iOS SPM | Modules / Packagist / SPM | Git tag GPG + ecosystem integrity | **Acceptable** |

## Intentional non-goals

- macOS notarization / Apple notarize
- Linux package-manager signing (deb/rpm)
- New certificates or secret stores for NuGet / Authenticode
- Revoking npm tokens until every inventoried package has a verified
  OIDC publish (see npm governance)

## Authenticode (human gate)

Do **not** wire `AzureSignTool` into `sdk-dotnet-release.yml` or
`cli-build-release.yml` until a human confirms the existing Key Vault
certificate `NUGET_SIGN_CERTIFICATE` has Extended Key Usage OID
`1.3.6.1.5.5.7.3.3` (Code Signing). Details:
[nuget-signing-status.md](nuget-signing-status.md).

## npm Trusted Publishing

All inventoried `@ops-ai/*` packages in `npm-packages.json` are marked
`oidcReady: true`. Each has a GitHub Trusted Publisher for
`ops-ai/Toggly.FeatureManagement`, the package’s `sdk-*-release.yml`,
and environment `npm-publish`. Release workflows use empty
`NODE_AUTH_TOKEN` and provenance-only publish (no soft `|| publish`
fallback).

Verified 2026-09-24 via `npm trust list` (correct file/repo/env) and
`node .github/package-registry/verify-npm-trusted-publishing.mjs`.

Contract check:

```bash
node .github/package-registry/verify-npm-trusted-publishing.mjs
```
