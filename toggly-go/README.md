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

## Get started

1. Create a free app at [toggly.io](https://toggly.io).
2. Install the module (Go 1.22+):

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
