# toggly-go

<p align="center">
  <a href="https://pkg.go.dev/github.com/ops-ai/Toggly.FeatureManagement/toggly-go"><img src="https://pkg.go.dev/badge/github.com/ops-ai/Toggly.FeatureManagement/toggly-go.svg" alt="Go Reference"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

Official Go SDK for [Toggly](https://toggly.io) — local feature-flag evaluation with periodic refresh, optional live updates, usage/metrics, and snapshot providers.

## What's included

| Package | Import path | Purpose |
|---------|-------------|---------|
| Core client | `.../toggly-go/toggly` | `NewClient`, `IsEnabled`, variants, usage/metrics |
| Snapshot | `.../toggly-go/toggly/snapshot` | Offline / startup cache (memory, file, Redis, SQLite, Postgres, MongoDB) |
| MongoDB Driver v2 snapshot adapter | `.../toggly-go-mongodb-v2` | Optional snapshot adapter for hosts using MongoDB Go Driver v2 |
| Session | `.../toggly-go/toggly/session` | Sticky results for percentage rollouts |
| Live updates | `.../toggly-go/toggly/live` | WebSocket refresh |
| Context helpers | `.../toggly-go/togglyctx` | Evaluation context helpers |
| HTTP helpers | `.../toggly-go/togglyhttp` | HTTP integration helpers |
| Templates | `.../toggly-go/togglytemplate` | Template helpers |

Entity `ContextProperty` filters evaluate `EntityContext` (`kind`, `key`, `attributes`) and are ANDed with user filters. `RegisterContext` optionally PUTs schemas to `sdk/{appKey}/contexts` (opt out with `DisableEntityContextRegistration`).

## Usage and business metrics

When `EnableUsage` / `EnableMetrics` are set, the SDK batches feature usage and business metrics and sends them over **native gRPC** (not gRPC-Web) to the Toggly gateway. Each `SendStats` / `SendMetrics` call includes `UA` metadata (`toggly-go/{version}`). `Close()` best-effort flushes pending batches before disconnecting.

Public usage APIs on `toggly.Client`:

- `RecordUsage` — interaction (“used”)
- `RecordView` — rendered/displayed (“viewed”)

Checks from `IsEnabled` are recorded automatically when usage is enabled. Wire payloads use multi-variant maps (`variantStats` / `variantValues`) aligned with the .NET SDK.

**Non-goal:** Go does not ship a .NET-style `IMetricsRegistryService` / SystemMetrics pull-collector registry. Call `MetricsClient().Measure|Increment|Observe` directly (optional `feature` + `variant`; empty variant defaults to `enabled`). Experiment auto-correlation (metric → linked features) is also out of scope — pass the feature argument when you need correlation.

## Get started

1. Create a free app at [toggly.io](https://toggly.io).
2. Install the module (Go 1.25+):

```bash
go get github.com/ops-ai/Toggly.FeatureManagement/toggly-go@latest
```

3. Evaluate a flag:

```go
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
	"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/session"
)

func main() {
	client, err := toggly.NewClient(toggly.Config{
		AppKey:         "YOUR_APP_KEY",
		Environment:    "Production",
		BaseURL:        "https://app.toggly.io/",
		DefinitionsURL: "https://definitions.toggly.io/",
		SessionStore:   session.NewMemoryStore(),
		SessionTTL:     30 * time.Minute,
	})
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = client.Close() }()

	on, err := client.IsEnabled(context.Background(), "MyFeature", toggly.Context{
		Identity: "user-123",
		Groups:   []string{"beta"},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("MyFeature enabled: %v\n", on)
}
```

Full example: [`examples/basic`](examples/basic).

## Documentation & resources

- **Product docs**: [docs.toggly.io](https://docs.toggly.io)
- **API reference**: [pkg.go.dev](https://pkg.go.dev/github.com/ops-ai/Toggly.FeatureManagement/toggly-go)
- **Snapshot providers**: [`toggly/snapshot/README.md`](toggly/snapshot/README.md)
- **MongoDB Go Driver v2 adapter**: [`../toggly-go-mongodb-v2/README.md`](../toggly-go-mongodb-v2/README.md)
- **SDK catalog (monorepo)**: [`../README.md`](../README.md)
- **Releases**: [`.github/RELEASE.md`](../.github/RELEASE.md) · current version in [`VERSION`](VERSION)

## Contributing

This package lives in the [Toggly.FeatureManagement](https://github.com/ops-ai/Toggly.FeatureManagement) monorepo. Please **open an issue first**, then follow the root [`CONTRIBUTING.md`](../CONTRIBUTING.md).

```bash
gofmt -w .
go test ./...
```

If you change publishable behavior, bump [`VERSION`](VERSION) and update [`CHANGELOG.md`](CHANGELOG.md) in the same PR.

## Security

Report vulnerabilities privately via [GitHub Private Vulnerability Reporting](https://github.com/ops-ai/Toggly.FeatureManagement/security/advisories/new). See the monorepo [`SECURITY.md`](../SECURITY.md).

## License

[MIT](LICENSE)


## Feature variants

`GetVariant` / `GetVariantValue` require **v0.10.0** (catalog-local
assignment since v0.9.0). Variants are assigned **locally** from the same
cached definitions catalog `IsEnabled` already uses — no separate network
call. The allocator replays Microsoft.FeatureManagement 4.7.0's
`FeatureManager.GetVariantAsync` bit-for-bit: disabled features resolve
`DefaultWhenDisabled` only; enabled features check User → Group → Percentile
→ `DefaultWhenEnabled`, in that order.

**Identity precedence** (first non-empty wins): per-call `Context.Identity`
→ ambient `WithEvalContext` / `togglyctx` → `Config.Identity` /
`Client.SetIdentity`. Groups come only from ambient or per-call Context.

### HTTP / middleware (preferred)

After `togglyhttp` (or any middleware that stores eval context on
`r.Context()`), pass an empty per-call Context:

```go
variant, err := client.GetVariant(r.Context(), "checkout-flow", toggly.Context{})
if err != nil {
    return err
}
if variant != nil {
    fmt.Println(variant.Name, variant.ConfigurationValue, variant.Enabled)
}
```

### CLI / worker

Set identity once at startup (or when the user session begins):

```go
client, err := toggly.NewClient(toggly.Config{
    AppKey:      "YOUR_APP_KEY",
    Environment: "Production",
    Identity:    "user-123", // optional default
})
// ...
client.SetIdentity("user-123")
variant, err := client.GetVariant(ctx, "checkout-flow", toggly.Context{})
```

`GetVariant` returns `nil, nil` when the feature is unknown or has no
`Variants` configured. `variant.Enabled` is the effective enabled state after
the assigned variant's `StatusOverride` is applied — this can differ from a
plain `IsEnabled` call, which never applies `StatusOverride`. Use
`GetVariantValue` as a shortcut when you only need the configuration payload:

```go
value, err := client.GetVariantValue(r.Context(), "checkout-flow", toggly.Context{})
```

Pass a non-empty per-call `Context` only when you need to **override** ambient
or client identity for that call (e.g. impersonation).

Set `Config.VariantIgnoreCase: true` to match user/group targeting names
case-insensitively (mirrors Microsoft.FeatureManagement's
`TargetingEvaluationOptions.IgnoreCase`). Default is `false`
(case-sensitive), matching Microsoft.FeatureManagement's own default.
