# Toggly Go MongoDB Driver v2 Adapter

`mongodbv2` is the MongoDB Go Driver v2 snapshot adapter for the official
[Toggly Go SDK](https://pkg.go.dev/github.com/ops-ai/Toggly.FeatureManagement/toggly-go).
It is a separate module so applications can choose MongoDB Driver v1 or v2
without placing both driver majors in the Toggly core module's dependency graph.

## Requirements

- Go 1.24 or later
- Toggly Go SDK v0.7.0 or later
- MongoDB Go Driver v2 (provided by this module)

The retained v1 adapter remains available from:

```go
"github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
```

Use this adapter only when the host application uses MongoDB Go Driver v2:

```bash
go get github.com/ops-ai/Toggly.FeatureManagement/toggly-go-mongodb-v2@latest
```

## Configure snapshots

```go
package main

import (
    "context"

    "github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
    mongodbv2 "github.com/ops-ai/Toggly.FeatureManagement/toggly-go-mongodb-v2"
    "go.mongodb.org/mongo-driver/v2/mongo"
    "go.mongodb.org/mongo-driver/v2/mongo/options"
)

func main() {
    ctx := context.Background()
    mongoClient, err := mongo.Connect(options.Client().ApplyURI("mongodb://localhost:27017"))
    if err != nil {
        panic(err)
    }
    defer func() { _ = mongoClient.Disconnect(ctx) }()

    provider := mongodbv2.NewMongoDBProvider(mongodbv2.MongoDBOptions{
        Collection: mongoClient.Database("toggly").Collection("snapshots"),
    })

    _, _ = toggly.NewClient(toggly.Config{
        AppKey:           "YOUR_APP_KEY",
        Environment:      "Production",
        SnapshotProvider: provider,
    })
}
```

## Stored-data compatibility

The adapter uses the existing `toggly_definitions` and `toggly_jwks` document
IDs by default. It reads and writes the same BSON fields as the retained Driver
v1 adapter: `_id`, `data`, `signature`, `kid`, `timestamp`, `rawDefs`, `etag`,
`expiry`, and `updatedAt`. Existing snapshots remain usable during a host's
MongoDB Driver v1-to-v2 migration. Configure `DefinitionsID` and `JWKSID` only
when an application already uses custom identifiers.

The compiled example at [`examples/snapshot`](examples/snapshot) uses the same
configuration.

## Development

```bash
go mod download
go mod verify
go vet ./...
go test -race ./...
```

Set `MONGO_TEST_URI` to run the integration tests against a disposable MongoDB
instance. The unit tests exercise persisted-document encoding and decoding
without a database.

## License

[MIT](LICENSE)
