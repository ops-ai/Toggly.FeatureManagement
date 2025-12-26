# Toggly CLI

Command-line interface for Toggly feature flag management. This CLI enables automation of Toggly operations including creating releases, associating builds, and managing features.

## Installation

### Download Pre-built Binaries

Download the appropriate binary for your platform from [GitHub Releases](https://github.com/ops-ai/Toggly.FeatureManagement/releases):

- **Windows**: `toggly-cli.exe`
- **Linux**: `toggly-cli` (x64 or ARM64)
- **macOS**: `toggly-cli` (Intel or Apple Silicon)

### Build from Source

```bash
# Clone the repository
git clone https://github.com/ops-ai/Toggly.FeatureManagement.git
cd Toggly.FeatureManagement/Toggly.FeatureManagement/Toggly.CLI

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

The CLI uses OAuth2 client credentials for authentication.

Set your OAuth2 credentials using one of these methods:

1. **Command-line arguments**:
   ```bash
   toggly-cli --client-id <id> --client-secret <secret> <command>
   ```

2. **Environment variables**:
   ```bash
   export TOGGLY_CLIENT_ID=<id>
   export TOGGLY_CLIENT_SECRET=<secret>
   export TOGGLY_AUTHORITY=https://auth.toggly.io  # Optional, defaults to https://auth.toggly.io
   toggly-cli <command>
   ```

3. **Config file**:
   ```json
   {
     "clientId": "your-client-id",
     "clientSecret": "your-client-secret",
     "authority": "https://auth.toggly.io"
   }
   ```

### Config File Format

Create a config file at `~/.toggly/config.json` (Linux/macOS) or `%USERPROFILE%\.toggly\config.json` (Windows):

```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "authority": "https://auth.toggly.io",
  "baseUrl": "https://app.toggly.io/api"
}
```

**Note**: You must specify both `clientId` and `clientSecret`.

## Commands

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

- `--client-id <id>`: OAuth2 client ID (required)
- `--client-secret <secret>`: OAuth2 client secret (required)
- `--authority <url>`: OAuth2 authority URL (defaults to https://auth.toggly.io)
- `--base-url <url>`: Base URL for Toggly API (defaults to https://app.toggly.io/api)
- `--verbose`: Enable verbose output

## Exit Codes

- `0`: Success
- `1`: Error (API error, network error, etc.)
- `2`: Validation error (missing required arguments, invalid authentication, etc.)

## Examples

### Using OAuth2

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

If you see "No authentication method specified", ensure you've provided:
- `--client-id` and `--client-secret`

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

