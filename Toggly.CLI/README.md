# Toggly CLI

Command-line interface for Toggly feature flag management. Supports interactive device-code login and CI client credentials equally.

## Installation

### Download Pre-built Binaries

Download the appropriate archive for your platform from the latest CLI GitHub Release ([`cli-v*`](https://github.com/ops-ai/Toggly.FeatureManagement/releases) tags):

| Platform | Release asset | Binary |
|----------|---------------|--------|
| Windows x64 | `toggly-cli-windows-x64.zip` | `toggly-cli.exe` |
| Linux x64 | `toggly-cli-linux-x64.tar.gz` | `toggly-cli` |
| Linux ARM64 | `toggly-cli-linux-arm64.tar.gz` | `toggly-cli` |
| macOS Intel | `toggly-cli-macos-x64.tar.gz` | `toggly-cli` |
| macOS Apple Silicon | `toggly-cli-macos-arm64.tar.gz` | `toggly-cli` |

### Build from Source

```bash
git clone https://github.com/ops-ai/Toggly.FeatureManagement.git
cd Toggly.FeatureManagement/Toggly.CLI
dotnet publish -c Release -r <RID> --self-contained -p:PublishSingleFile=true -p:PublishAot=true
```

Where `<RID>` is one of: `win-x64`, `linux-x64`, `linux-arm64`, `osx-x64`, `osx-arm64`.

## Authentication

Priority order (highest first):

1. **Explicit client credentials** — `--client-id` + `--client-secret`, or `TOGGLY_CLIENT_ID` + `TOGGLY_CLIENT_SECRET` (CI / machines)
2. **Device-code session** — OS credential store after `toggly auth login`
3. Otherwise the command fails with guidance to log in or set CI env vars

**Never** write tokens or client secrets to plaintext files. A legacy `~/.toggly/config.json` (if present) is deleted automatically on use.

```bash
toggly-cli auth login
toggly-cli auth status
toggly-cli auth logout
```

## Context preferences (non-secret)

Default application and environment are stored under the user config directory — never secrets:

| OS | Path |
|----|------|
| Linux / macOS | `$XDG_CONFIG_HOME/toggly/prefs.json` or `~/.config/toggly/prefs.json` |
| Windows | `%AppData%\toggly\prefs.json` |

```bash
toggly-cli context set --app <app-id> --env Production
toggly-cli context get
toggly-cli context clear
```

When `--app` / `--env` (or `--application-id` / `--environment`) are omitted, list/get and write commands use these defaults. Exit code `2` if neither flag nor pref is set.

## Command tree

```text
toggly
├── auth login|logout|status
├── app list|get <id>
├── env list|get <name>          # --app
├── feature list|get <key>       # --app
│         create|update|update-environment
├── release list|get <id>        # optional --app / --env / --status / --search
│         create|associate-build
└── context set|get|clear
```

Flat write aliases (same handlers; deprecation window):

- `create-feature` → `feature create`
- `update-feature` → `feature update`
- `update-feature-environment` → `feature update-environment`
- `create-release` → `release create`
- `associate-build` → `release associate-build`

### Read examples

```bash
toggly-cli app list
toggly-cli app get <app-id>
toggly-cli env list --app <app-id>
toggly-cli env get --app <app-id> Production
toggly-cli feature list --app <app-id>
toggly-cli feature get --app <app-id> payments-enabled
toggly-cli release list --app <app-id>
toggly-cli release get <release-id>
```

### Write examples

```bash
toggly-cli feature create --app <app-id> --name "New Feature" --feature-key new-feature
toggly-cli feature update --app <app-id> --feature-key new-feature --description "Updated"
toggly-cli feature update-environment --app <app-id> --env Production --feature-key new-feature --enable

toggly-cli release create --app <app-id> --name "v1.2.0"
toggly-cli release associate-build \
  --project-key <app-id-or-name> \
  --env Production \
  --ci-provider github \
  --run-id 123456 \
  --pipeline-name "deploy-production"
```

Flat aliases still accept `--application-id` / `--environment` as used in existing scripts.

## Output

- Default: human-readable text
- `--json`: camelCase JSON via source-generated serializers (AOT-friendly)

```bash
toggly-cli --json app list
toggly-cli --json feature get --app <app-id> payments-enabled
```

## Global options

- `--client-id` / `--client-secret` (or `TOGGLY_CLIENT_ID` / `TOGGLY_CLIENT_SECRET`)
- `--authority` (or `TOGGLY_AUTHORITY`; default https://auth.toggly.io)
- `--base-url` (or `TOGGLY_BASE_URL`; default https://app.toggly.io/api)
- `--verbose`
- `--json`

## Exit codes

- `0`: Success
- `1`: Runtime / API error (including HTTP 404)
- `2`: Usage / validation / missing auth or missing `--app` when no context default

## CI/CD example

```yaml
- name: Associate build with release
  run: |
    toggly-cli associate-build \
      --project-key ${{ github.repository }} \
      --environment Production \
      --ci-provider github \
      --run-id ${{ github.run_id }} \
      --pipeline-name "${{ github.workflow }}" \
      --branch ${{ github.ref_name }} \
      --commit-sha ${{ github.sha }} \
      --client-id ${{ secrets.TOGGLY_CLIENT_ID }} \
      --client-secret ${{ secrets.TOGGLY_CLIENT_SECRET }}
```

## Troubleshooting

- Interactive: `toggly-cli auth login`, then `auth status`.
- CI: provide both client id and secret via flags or env.
- Linux device login needs libsecret + a desktop keyring.
- Missing app: pass `--app` or run `context set --app <id>`.

## License

See the main repository LICENSE file.

## Support

For issues and questions, please open an issue on [GitHub](https://github.com/ops-ai/Toggly.FeatureManagement/issues).
