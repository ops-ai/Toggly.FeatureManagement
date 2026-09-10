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
2. Install the module (Go 1.24+):

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


## Initial targeting for remote variants

`VariantGroups` and `VariantClaims` require **v0.7.0 (release pending)**.
These fields belong to one client-wide remotely evaluated variants context:

```go
client, err := toggly.NewClient(toggly.Config{
    AppKey: "YOUR_APP_KEY",
    Environment: "Production",
    EnableVariants: true,
    // Identity is a stable user identifier used for variant allocation.
    VariantIdentity: "user-123",
    // Groups are memberships used by targeting and group allocation rules.
    VariantGroups: []string{"beta", "subscribers"},
    // Claims are string attributes used by feature rules, including enabled/disabled defaults.
    VariantClaims: map[string]string{"plan": "pro"},
})
if err != nil {
    return err
}
defer client.Close()
```

The client copies the supplied groups and claims before its initial background
refresh, so that first request already has the intended targeting. No identity
setter or second refresh is needed to seed it. Initialization is asynchronous;
variant results become available after the first successful refresh.

Blank groups and empty claim names/values are omitted. Claims are sorted by
name and limited to 20. Omitted and empty collections both send no targeting
values. Groups use repeated `g` parameters; the backend treats commas inside a
group value as separators, so avoid commas in group names.

Use one variants client per context. `SetVariantIdentity` changes the shared
client's identity and clears its prior evaluated payload; it is unsuitable for
switching users on each HTTP request. Ordinary boolean evaluation with
`EnableVariants: false` continues to use request-local `toggly.Context` passed
to `IsEnabled`; these startup fields do not replace that context. In variants
mode the server supplies the enabled result as well as the assigned variant.

Persisted variant payloads and revisions are accepted only for the same complete
context, endpoint, app and environment. Legacy variant snapshots without context
metadata require a fresh fetch. A single snapshot store may be shared safely,
but using a separate store per variants client avoids cache replacement churn.
