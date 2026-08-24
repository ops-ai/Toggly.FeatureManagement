# NuGet Organization and Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move only Toggly NuGet packages into the `Toggly` organization, publish the approved avatar, standardize package presentation, and adopt trusted publishing without changing package IDs.

**Architecture:** Separate profile/ownership mutations from repository and release changes. Ownership first overlaps `opsai` and `Toggly`; the workflow then proves organization-owned OIDC publication while existing Key Vault signing remains intact; only afterward may the personal owner and NuGet API key be removed.

**Tech Stack:** NuGet.org organizations, Gravatar, MSBuild/NuGet pack, GitHub Actions OIDC, NuGet Key Vault signing

**Spec:** `docs/plans/2026-08-24-package-registry-professionalization-design.md`

## Global Constraints

- Preserve all eleven NuGet package IDs listed in the spec.
- Do not change ownership of any non-`Toggly.*` package on the `opsai` profile.
- Keep Key Vault package signing unchanged while replacing only NuGet publishing authentication.
- Use `Toggly`, `support@toggly.io`, `https://toggly.io`, actual repository URLs, `MIT`, and the approved icon.
- A package metadata change requires a patch version and `Toggly.FeatureManagement.NET/CHANGELOG.md` entry.
- Organization creation, ownership removal, prefix reservation, and credential revocation are human gates.

---

### Task 1: Produce the Toggly registry avatar

**Files:**
- Source: `/Users/alexandrupuiu/development/Toggly/Toggly/src/Toggly.Web/ClientApp/src/assets/images/logo/favicon.png`
- Create: `/Users/alexandrupuiu/development/Toggly/toggly.io/public/brand/toggly-avatar-1024.png`
- Create: `/Users/alexandrupuiu/development/Toggly/toggly.io/public/brand/toggly-gravatar-512.png`

**Interfaces:**
- Consumes: the existing Toggly toggle-switch mark and exact avatar contract from the spec.
- Produces: square PNG assets suitable for Gravatar, NuGet, and other registry profiles.

- [ ] **Step 1: Confirm the source asset dimensions and alpha channel**

```bash
file /Users/alexandrupuiu/development/Toggly/Toggly/src/Toggly.Web/ClientApp/src/assets/images/logo/favicon.png
```

Expected: a readable PNG with an alpha channel; do not use the unrelated legacy triangular icon.

- [ ] **Step 2: Render deterministic exports**

Create a 1024-pixel square with background `#556EE6`, center a white version of the toggle mark inside a 614-pixel safe box, and downsample it to 512 pixels with a high-quality Lanczos filter. Do not add text, gradient, shadow, or AI-generated content.

- [ ] **Step 3: Verify raster properties**

```bash
file toggly.io/public/brand/toggly-avatar-1024.png toggly.io/public/brand/toggly-gravatar-512.png
```

Expected: exactly `1024 x 1024` and `512 x 512` PNG images with no embedded credentials or private metadata.

- [ ] **Step 4: Visually verify small and circular crops**

Inspect the 512-pixel asset at 32, 64, 128, and 256 pixels and through a centered circular mask. The complete mark must remain visible with high contrast at 32 pixels.

- [ ] **Step 5: Commit the avatar assets in the website repository**

```bash
git add public/brand/toggly-avatar-1024.png public/brand/toggly-gravatar-512.png
git diff --cached --name-only
git commit -F - <<'EOF'
Add Toggly registry avatar assets [OPS-725]

Derive square Gravatar and registry-profile assets from the established
Toggly toggle-switch mark with safe small-size and circular-crop padding.

Linear Issues:
- OPS-725: Move Toggly NuGet packages to the Toggly organization and publish the registry avatar
EOF
```

### Task 2: Create and populate the NuGet organization

**Files:**
- Read: `.github/workflows/sdk-dotnet-release.yml`
- External: NuGet.org `Toggly` organization and the eleven package ownership pages

**Interfaces:**
- Consumes: approved company-controlled organization email, two NuGet administrator accounts, and the avatar from Task 1.
- Produces: additive `Toggly` co-ownership for exactly the eleven packages, with `opsai` temporarily retained.

- [ ] **Step 1: Capture the live baseline**

Export or record the `opsai` package list and owners for the eleven exact IDs. Abort if a requested package is not currently owned by `opsai` or if an additional `Toggly.*` package appears; update the reviewed inventory before proceeding.

- [ ] **Step 2: Present the exact mutation set**

Show the organization display name, profile email boundary, two administrators, eleven additions, zero removals, and Gravatar asset. Obtain explicit approval.

- [ ] **Step 3: Create `Toggly` and add administrators**

Create the organization, set its profile to the company-controlled Gravatar address, accept administrator invitations, and verify recovery access from the second administrator account.

- [ ] **Step 4: Add `Toggly` as owner to the eleven packages**

Send and accept ownership invitations one package at a time. After each acceptance, refresh the public package page and record both owners.

- [ ] **Step 5: Verify package set isolation**

Compare the final organization package list to the eleven-item spec. Confirm that BeyondAuth, Audit.NET, and every other `opsai` package remain absent from `Toggly`.

### Task 3: Standardize .NET package metadata and icon

**Files:**
- Modify: `Toggly.FeatureManagement.NET/Directory.Build.props`
- Modify: the eleven publishable `.csproj` files named by `.github/workflows/sdk-dotnet-release.yml`
- Modify: `Toggly.FeatureManagement.NET/CHANGELOG.md`
- Create: `Toggly.FeatureManagement.NET/assets/toggly-package-icon.png`
- Test: `.github/workflows/sdk-dotnet-release.yml`

**Interfaces:**
- Consumes: public metadata contract and 512-pixel avatar source.
- Produces: eleven packages with consistent author/company, icon, homepage, repository, README, license, and tags at one patch version.

- [ ] **Step 1: Add a package metadata contract test**

Add a repository script or test that enumerates the exact eleven workflow projects and fails unless each packed `.nuspec` contains `Toggly`, `https://toggly.io`, `https://github.com/ops-ai/Toggly.FeatureManagement`, `MIT`, a README, and `toggly-package-icon.png`.

- [ ] **Step 2: Run the contract test and capture its failures**

Expected: failure on mixed `packagephoto.png` and `toggly_favicon.png` values and any missing shared metadata.

- [ ] **Step 3: Centralize shared metadata**

In `Directory.Build.props`, define shared packable-project values for `Authors`, `Company`, `PackageProjectUrl`, `RepositoryUrl`, `RepositoryType`, `PackageLicenseExpression`, `PackageIcon`, and shared tags. Preserve package-specific descriptions, README paths, and additional tags in individual projects.

- [ ] **Step 4: Add the standardized package icon**

Copy the approved 512-pixel package icon into `Toggly.FeatureManagement.NET/assets/toggly-package-icon.png` and include it in every package using a shared `Pack=true` item with root package path.

- [ ] **Step 5: Remove duplicated or conflicting metadata**

Remove the two old icon names and duplicated shared values from the eleven `.csproj` files. Do not change `PackageId` values or assembly identities.

- [ ] **Step 6: Bump the manifest and changelog**

Increment the patch component in `Toggly.FeatureManagement.NET/Directory.Build.props` and add a changelog entry stating that package ownership presentation, metadata, icon, and publishing provenance were standardized with no API change.

- [ ] **Step 7: Pack and inspect all eleven packages**

```bash
dotnet build Toggly.FeatureManagement.NET/Toggly.FeatureManagement.sln -c Release
dotnet test Toggly.FeatureManagement.NET/Toggly.FeatureManagement.sln -c Release --no-build
dotnet pack Toggly.FeatureManagement.NET/Toggly.FeatureManagement.sln -c Release --no-build --output /tmp/toggly-nuget-packages
```

Expected: build and tests pass; every expected package is created once and the metadata contract passes.

### Task 4: Adopt NuGet trusted publishing

**Files:**
- Modify: `.github/workflows/sdk-dotnet-release.yml`
- Modify: `.github/RELEASE.md`

**Interfaces:**
- Consumes: NuGet organization ownership and the exact GitHub repository/workflow identity.
- Produces: short-lived NuGet publication authentication while preserving package signing.

- [ ] **Step 1: Add workflow authentication coverage**

Add a structural workflow test that requires `id-token: write`, `NuGet/login@v1`, and absence of `secrets.NUGET_API_KEY` from the publish command. It must also require every existing `NUGET_SIGN_*` reference so signing cannot be accidentally removed.

- [ ] **Step 2: Confirm the test fails against the API-key workflow**

Expected: failure because the current workflow passes `secrets.NUGET_API_KEY` to `dotnet nuget push`.

- [ ] **Step 3: Configure the NuGet trusted-publishing policy**

In the `Toggly` organization, create a policy for repository `ops-ai/Toggly.FeatureManagement`, workflow `sdk-dotnet-release.yml`, and the exact release environment if the final workflow uses one. Obtain explicit approval before saving the external policy.

- [ ] **Step 4: Update the workflow**

Grant `id-token: write`, authenticate using `NuGet/login@v1`, and pass the action-provided temporary API key to `dotnet nuget push`. Keep the signing steps byte-for-byte equivalent except for unavoidable surrounding job wiring.

- [ ] **Step 5: Verify locally and through the PR**

Run the structural workflow test, `git diff --check`, the .NET build/test/pack commands from Task 3, Oracle, and all hosted required checks on the exact PR head.

- [ ] **Step 6: Publish and verify one normal patch release**

Dispatch the stabilized workflow for the metadata patch. Verify live organization ownership, author/company, icon, source, signature, repository metadata, and NuGet trusted-publishing provenance for all selected packages.

- [ ] **Step 7: Remove legacy ownership and credentials**

After a fresh successful-publish review and explicit approval, remove `opsai` from the eleven packages and revoke `NUGET_API_KEY`. Verify the `opsai` profile still owns all unrelated packages and the `Toggly` organization owns exactly the intended package set.

### Task 5: Reserve the `Toggly.*` prefix

**Files:**
- External: NuGet package ID prefix reservation request

**Interfaces:**
- Consumes: final Toggly organization ownership and evidence for all existing IDs.
- Produces: a verified prefix and protection against misleading new package IDs.

- [ ] **Step 1: Prepare the request**

List `Toggly.` as the requested prefix, the `Toggly` organization as owner, the eleven existing packages as evidence, and the official product and source URLs.

- [ ] **Step 2: Obtain approval and submit**

Show the completed request to the human operator before submitting it.

- [ ] **Step 3: Verify the live result**

After NuGet processes the request, confirm the verified prefix indicator on every eligible package and document any exception without changing its package ID.
