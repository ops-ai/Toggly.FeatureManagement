# NuGet / package signing status (OPS-943 / OPS-1411)

## NuGet package signing (enabled)

Release workflow `.github/workflows/sdk-dotnet-release.yml` signs both
`*.nupkg` and `*.snupkg` with `NuGetKeyVaultSignTool` using the existing
`NUGET_SIGN_*` GitHub secrets (Azure Key Vault certificate). No new secret
store was introduced.

GitHub Releases for the .NET SDK and CLI attach `SHA256SUMS` plus a
detached GPG signature (`SHA256SUMS.asc`) using the existing
`GPG_PRIVATE_KEY` / `GPG_PASSPHRASE` secrets.

## Authenticode for Windows CLI (enabled)

`cli-build-release.yml` signs Windows `toggly-cli.exe` with `AzureSignTool`
after `dotnet publish` and before the release zip, using the same
`NUGET_SIGN_*` Key Vault credentials as NuGet signing.

Verified 2026-09-24 against the issued certificate in
`https://opsaikubevault.vault.azure.net/` (`opsAISigningCert`):

- Issuer: GlobalSign GCC R45 CodeSigning CA 2020
- Subject: Opsai LLC
- Extended Key Usage: Code Signing (`1.3.6.1.5.5.7.3.3`)
- Valid through 2027-08-18

Note: Key Vault *certificate policy* metadata for this cert still lists
Server/Client Authentication EKUs. That policy blob is stale relative to
the issued GlobalSign leaf — trust the downloaded certificate, not the
policy EKUs, when re-checking.

The Windows job fails the release if `Get-AuthenticodeSignature` does not
report `Valid`.

## Authenticode for packed .NET DLLs (not enabled)

Authenticode signing of NuGet-packed DLLs remains out of scope. NuGet
package signatures already cover those artifacts for the NuGet ecosystem;
Authenticode on every packed DLL adds little for library consumers and is
not wired into `sdk-dotnet-release.yml`.

## Explicit non-goals

- macOS notarization / Apple notarize
- Linux package-manager signing (deb/rpm)

These require secrets or infrastructure that are not already provisioned.
