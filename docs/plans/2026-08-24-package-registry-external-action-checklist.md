# Toggly Package Registry External-Action Checklist

Use this checklist under parent `OPS-724` and the relevant registry child issue `OPS-725` through `OPS-734`. Each checked mutation must include a fresh-page evidence link or screenshot in the issue. Never paste secrets into the issue or repository.

## Approval envelope

- [ ] Confirm exact company-controlled Gravatar email privately.
- [ ] Confirm the two recovery administrators for NuGet, npm, PyPI, pub.dev, Maven Central, and GitHub.
- [ ] Confirm the company RubyGems account and named recovery owner.
- [ ] Confirm GitHub team `ops-ai/toggly-sdk-maintainers` and its membership.
- [ ] Approve or decline paid PyPI corporate organization membership at the current per-member price.
- [ ] Approve the exact ownership additions, delayed removals, trusted-publisher records, DNS records, and token revocations below.

## NuGet

- [ ] Record the current `opsai` owner list and live package URLs for the eleven approved IDs.
- [ ] Create organization `Toggly` with the approved company-controlled Gravatar address.
- [ ] Add and verify two organization administrators.
- [ ] Add `Toggly` as co-owner to exactly the eleven approved packages; keep `opsai` during overlap.
- [ ] Verify no BeyondAuth, Audit.NET, or unrelated package entered the organization.
- [ ] Configure trusted publisher: organization `Toggly`, repository `ops-ai/Toggly.FeatureManagement`, workflow `sdk-dotnet-release.yml`, and the exact release environment used by the final workflow.
- [ ] Complete and verify one normal signed OIDC release.
- [ ] Submit the reserved-prefix request for `Toggly.`.
- [ ] Obtain removal approval, remove `opsai` from the eleven packages, and verify unrelated ownership remains unchanged.
- [ ] Obtain revocation approval and revoke the superseded NuGet publishing API key; retain Key Vault signing credentials.

## npm

- [ ] Record whether `ops-ai` is a user or organization, all public packages, owners, 2FA, teams, granular tokens, and trusted publishers.
- [ ] Convert `ops-ai` to an organization if needed; never create a replacement scope.
- [ ] Add and verify two organization administrators and the SDK publisher team.
- [ ] Configure the exact package-to-workflow trusted-publisher record for each package inventory row.
- [ ] Publish and verify each framework group with provenance.
- [ ] Obtain revocation approval and revoke tokens no remaining publisher requires.

## pub.dev

- [ ] Record the five live packages and automated-publishing configurations under verified publisher `toggly.io`.
- [ ] Verify two company-controlled publisher administrators.
- [ ] Do not change publisher ownership unless the inventory finds a missing package or recovery gap.

## PyPI

- [ ] Record all five projects, owners/maintainers, roles, live versions, provenance, and trusted publishers.
- [ ] Present exact member count and recurring monthly price; obtain paid-organization approval.
- [ ] Create corporate organization `Toggly`, two owners, and a publisher team.
- [ ] Transfer all five projects without renaming and retain existing owners during overlap.
- [ ] Verify names, releases, install commands, downloads, project URLs, and trusted publishers.
- [ ] Remove only explicitly approved redundant individual owners while retaining recovery.

## RubyGems

- [ ] Record owners, MFA, live versions, and trusted-publisher identity for all three gems.
- [ ] Add the approved company-controlled named owner and verify access.
- [ ] Retain at least one named recovery owner.
- [ ] Publish and verify metadata through the existing trusted workflow.
- [ ] Remove only explicitly approved redundant owners.

## crates.io

- [ ] Record named/team owners, live versions, and publishing authentication for all five crates.
- [ ] Create or confirm GitHub team `ops-ai/toggly-sdk-maintainers` and exact members.
- [ ] Add `github:ops-ai:toggly-sdk-maintainers` as team owner to all five crates and retain one named recovery owner.
- [ ] Configure trusted publisher: repository `ops-ai/Toggly.FeatureManagement`, workflow `sdk-rust-release.yml`, and exact environment.
- [ ] Publish and verify all crates through OIDC in dependency order.
- [ ] Obtain revocation approval and revoke `CARGO_REGISTRY_TOKEN`.

## Packagist

- [ ] Record live maintainers, support email, source URL, latest stable version, and GitHub auto-update state.
- [ ] Add and verify a second company-controlled maintainer.
- [ ] Verify the GitHub service/webhook targets `ops-ai/Toggly.FeatureManagement.PHP`.
- [ ] Publish a signed stable tag after repository metadata passes review.
- [ ] Verify `support@toggly.io` replaces the live typo and the stable version is installable.

## Maven Central

- [ ] Record every live `io.toggly` artifact, version, current namespace owner, source, and POM metadata; explicitly record if no artifact is live.
- [ ] Create or normalize the Toggly Central Portal organization with two administrators.
- [ ] Map and verify namespace `io.toggly`; add only the DNS TXT record Central supplies if verification is required.
- [ ] Generate a least-privilege organization portal token and keep existing GPG signing.
- [ ] Publish and verify the Android and Java waves separately.
- [ ] Obtain revocation approval and revoke superseded portal credentials only after all required waves succeed.

## GitHub-distributed Go, Swift, and CLI

- [ ] Record current repository description, website, topics, social preview, tag prefixes, and latest releases.
- [ ] Present the exact replacement text, topics, and social-preview image for approval.
- [ ] Apply approved repository metadata without moving the repository.
- [ ] Verify signed tags, release notes, checksums, and ecosystem-native installation from fresh consumers.

## Closeout

- [ ] Re-run every published install command without modifying coordinates.
- [ ] Confirm all intended company and recovery owners from fresh registry pages.
- [ ] Confirm all supported registries show trusted-publishing provenance.
- [ ] Confirm revoked credentials are absent from GitHub configuration and cannot publish.
- [ ] Confirm no unrelated NuGet ownership changed.
- [ ] Link source verification, hosted PR verification, and live registry verification as three distinct evidence sets.
