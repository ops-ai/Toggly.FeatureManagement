# toggly-go

Go SDK for Toggly Feature Management (local evaluation).

## Status
Work in progress.

## Publishing

This SDK is a Go module:

- **Module path**: `github.com/ops-ai/Toggly.FeatureManagement/toggly-go`
- **Go version**: 1.22+

### Release checklist

- **Ensure `go.mod` module path is correct**: it must match the repo location and directory (`.../toggly-go`).
- **Run formatting + tests**:

```bash
gofmt -w .
go test ./...
```

- **Tag a semantic version**:
  - For first public release, start with `v0.1.0` (or `v1.0.0` if you consider the API stable).
  - Go modules resolve versions from **Git tags**.

```bash
git tag v0.1.0
git push origin v0.1.0
```

- **Create a GitHub Release** for the tag (recommended). The Go ecosystem doesn’t require release artifacts for libraries; tags are enough.

### Versioning notes (Go module semantics)

- **Major versions**:
  - `v0.x.y` is allowed without changing the import path.
  - If you ever release `v2+`, Go requires the module path to include the major suffix, e.g.:
    - `module github.com/ops-ai/Toggly.FeatureManagement/toggly-go/v2`
    - and consumers import `.../toggly-go/v2/...`

### How consumers install

Consumers typically just import packages; `go get` is optional but can be used to pin a version:

```bash
go get github.com/ops-ai/Toggly.FeatureManagement/toggly-go@v0.1.0
```

Then in code:

```go
import "github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
```

### Go module proxy / availability

After pushing a tag, the module should be available via the public Go module proxy (if the repository is publicly accessible). If you don’t see it immediately, it can take a short time to appear.
