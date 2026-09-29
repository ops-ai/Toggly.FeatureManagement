# Toggly CLI

Command-line interface for Toggly feature flag management. This CLI enables automation of Toggly operations including creating releases, associating builds, and managing features.

## Installation

### Download Pre-built Binaries

Download the appropriate archive for your platform from the latest CLI GitHub Release ([`cli-v0.2.0`](https://github.com/ops-ai/Toggly.FeatureManagement/releases/tag/cli-v0.2.0); later tags follow `cli-v*`):

| Platform | Release asset | Binary |
|----------|---------------|--------|
| Windows x64 | `toggly-cli-windows-x64.zip` | `toggly-cli.exe` |
| Linux x64 | `toggly-cli-linux-x64.tar.gz` | `toggly-cli` |
| Linux ARM64 | `toggly-cli-linux-arm64.tar.gz` | `toggly-cli` |
| macOS Intel | `toggly-cli-macos-x64.tar.gz` | `toggly-cli` |
| macOS Apple Silicon | `toggly-cli-macos-arm64.tar.gz` | `toggly-cli` |

### Build from Source

```bash
# Clone the repository
git clone https://github.com/ops-ai/Toggly.FeatureManagement.git
cd Toggly.FeatureManagement/Toggly.CLI

# Build for your platform
dotnet publish -c Release -r <RID> --self-contained -p:PublishSingleFile=true -p:PublishAot=true
```

Where `<RID>` is one of:
- `win-x64` (Windows)
- `linux-x64` (Linux Intel/AMD)
- `linux-arm64` (Linux ARM)
- `osx-x64` (macOS Intel)
- `osx-arm64` (macOS Apple Silicon)

## Configuration

### Authentication

The CLI supports two authentication modes. Priority order (highest first):

1. **Explicit client credentials** — `--client-id` + `--client-secret`, or `TOGGLY_CLIENT_ID` + `TOGGLY_CLIENT_SECRET` (CI / machines)
2. **Device-code session** — stored only in the OS credential store after `toggly auth login`
3. Otherwise the command fails with guidance to log in or set CI env vars

**Never** write tokens or client secrets to plaintext files. A legacy `~/.toggly/config.json` (if present) is deleted automatically on use.

If both an OS session and `TOGGLY_CLIENT_SECRET` are present, **env/flags win** so CI shells stay deterministic.

#### Interactive login (humans)

```bash
toggly-cli auth login
toggly-cli auth status
toggly-cli auth logout
```

`auth login` starts the OAuth2 device-code flow against `https://auth.toggly.io` (overridable with `--authority`). Tokens are stored in:

| OS | Store |
|----|--------|
| macOS | Keychain (`toggly-cli` / `auth-session`) |
| Windows | Credential Manager |
| Linux | libsecret (desktop keyring required) |

`auth status` shows client id, expiry, and authority — **never** access or refresh tokens (including with `--verbose`).

#### Machine / CI credentials

```bash
toggly-cli --client-id <id> --client-secret <secret> <command>
```

Or:

```bash
export TOGGLY_CLIENT_ID=<id>
export TOGGLY_CLIENT_SECRET=<secret>
export TOGGLY_AUTHORITY=https://auth.toggly.io  # Optional
export TOGGLY_BASE_URL=https://app.toggly.io/api  # Optional
toggly-cli <command>
```

## Commands

### Auth Commands

```bash
toggly-cli auth login [--authority <url>] [--client-id <id>] [--scopes <scopes>]
toggly-cli auth logout
toggly-cli auth status
```

Default device client id is `toggly-cli`. Default device scopes are `openid toggly offline_access`.

### Release Commands

#### Create Release

Create a new release:

```bash
toggly-cli create-release \
  --application-id <app-id> \
  --name "v1.2.0" \
  --release-notes "New features and improvements"
```

With feature changes:

```bash
toggly-cli create-release \
  --application-id <app-id> \
  --name "v1.2.0" \
  --feature-changes '[{"flagKey":"new-feature","toState":[{"name":"AlwaysOn","parameters":{}}]}]'
```

#### Associate Build

Associate a CI build with a release:

```bash
toggly-cli associate-build \
  --project-key <app-id-or-name> \
  --environment Production \
  --ci-provider github \
  --run-id 123456 \
  --pipeline-name "deploy-production" \
  --branch main \
  --commit-sha abc123def456 \
  --build-number "1.2.3"
```

### Feature Commands

#### Create Feature

Create a new feature:

```bash
toggly-cli create-feature \
  --application-id <app-id> \
  --name "New Feature" \
  --feature-key new-feature \
  --description "Description of the feature" \
  --category "Category" \
  --tags "tag1,tag2"
```

#### Update Feature

Update an existing feature:

```bash
toggly-cli update-feature \
  --application-id <app-id> \
  --feature-key new-feature \
  --description "Updated description"
```

### Environment Commands

#### Update Feature Environment

Update feature configuration on a specific environment:

**Enable a feature:**
```bash
toggly-cli update-feature-environment \
  --application-id <app-id> \
  --environment Production \
  --feature-key new-feature \
  --enable
```

**Disable a feature:**
```bash
toggly-cli update-feature-environment \
  --application-id <app-id> \
  --environment Production \
  --feature-key new-feature \
  --disable
```

**Set custom filters:**
```bash
toggly-cli update-feature-environment \
  --application-id <app-id> \
  --environment Production \
  --feature-key new-feature \
  --filters '[{"name":"TargetingFilter","parameters":{"Audience":"beta-users"}}]'
```

## Global Options

All commands support these global options:

- `--client-id <id>`: OAuth2 client ID (or `TOGGLY_CLIENT_ID`)
- `--client-secret <secret>`: OAuth2 client secret (or `TOGGLY_CLIENT_SECRET`)
- `--authority <url>`: OAuth2 authority URL (or `TOGGLY_AUTHORITY`; default https://auth.toggly.io)
- `--base-url <url>`: Base URL for Toggly API (or `TOGGLY_BASE_URL`; default https://app.toggly.io/api)
- `--verbose`: Enable verbose output

## Exit Codes

- `0`: Success
- `1`: Error (API error, network error, etc.)
- `2`: Validation error (missing required arguments, invalid authentication, etc.)

## Examples

### Interactive session

```bash
toggly-cli auth login
toggly-cli create-release --application-id abc123 --name "v1.0.0"
toggly-cli auth logout
```

### Using OAuth2 client credentials

```bash
toggly-cli --client-id <id> --client-secret <secret> create-release \
  --application-id abc123 \
  --name "v1.0.0"
```

### CI/CD Integration

In a GitHub Actions workflow:

```yaml
- name: Associate build with release
  run: |
    toggly-cli associate-build \
      --project-key ${{ github.repository }} \
      --environment Production \
      --ci-provider github \
      --run-id ${{ github.run_id }} \
      --run-url ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }} \
      --pipeline-name "${{ github.workflow }}" \
      --branch ${{ github.ref_name }} \
      --commit-sha ${{ github.sha }} \
      --client-id ${{ secrets.TOGGLY_CLIENT_ID }} \
      --client-secret ${{ secrets.TOGGLY_CLIENT_SECRET }}
```

## Troubleshooting

### Authentication Errors

- Interactive: run `toggly-cli auth login`, then `toggly-cli auth status`.
- CI: provide both `--client-id` and `--client-secret`, or set `TOGGLY_CLIENT_ID` and `TOGGLY_CLIENT_SECRET`.
- Linux: install libsecret and a desktop keyring; plaintext credential files are not supported.

### Network Errors

If you encounter network errors, verify:
- Your internet connection
- The API base URL is correct (default: https://app.toggly.io/api)
- Firewall/proxy settings allow outbound HTTPS connections

### JSON Parsing Errors

When providing JSON arguments (e.g., `--feature-changes`, `--filters`), ensure:
- The JSON is properly formatted
- Strings are properly escaped
- Arrays and objects are correctly structured

## License

See the main repository LICENSE file.

## Support

For issues and questions, please open an issue on [GitHub](https://github.com/ops-ai/Toggly.FeatureManagement/issues).
