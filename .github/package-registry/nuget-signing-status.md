# NuGet / package signing status (OPS-943)

## NuGet package signing (enabled)

Release workflow `.github/workflows/sdk-dotnet-release.yml` signs both
`*.nupkg` and `*.snupkg` with `NuGetKeyVaultSignTool` using the existing
`NUGET_SIGN_*` GitHub secrets (Azure Key Vault certificate). No new secret
store was introduced.

GitHub Releases for the .NET SDK and CLI attach `SHA256SUMS` plus a
detached GPG signature (`SHA256SUMS.asc`) using the existing
`GPG_PRIVATE_KEY` / `GPG_PASSPHRASE` secrets.

## Authenticode (not enabled)

Authenticode signing of packed DLLs and Windows `toggly-cli.exe` is **gated
on a human Key Vault certificate EKU check** and is **not enabled** in this
change.

Required EKU for Authenticode / AzureSignTool code signing:

- OID `1.3.6.1.5.5.7.3.3` (Code Signing)

This environment could not inspect the Key Vault certificate’s Extended Key
Usage. Until a human confirms that OID is present on the existing
`NUGET_SIGN_CERTIFICATE`:

1. Do **not** wire AzureSignTool into `sdk-dotnet-release.yml` or
   `cli-build-release.yml`.
2. Do **not** invent a new certificate or secret store.

If the EKU check passes, enable Authenticode with the same vault URL /
client / tenant / secret / certificate already used for NuGet signing.

If the EKU check fails (certificate is NuGet signing only), keep this
document as the record and leave Authenticode out of scope.

## Explicit non-goals

- macOS notarization / Apple notarize
- Linux package-manager signing (deb/rpm)

These require secrets or infrastructure that are not already provisioned.
