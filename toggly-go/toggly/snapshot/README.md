# Toggly Go Snapshot Providers

This package provides storage providers for persisting Toggly feature flag snapshots. When the SDK can't reach the Toggly API, it falls back to these cached snapshots.

## Available Providers

### File Provider (Built-in)

Stores snapshots as JSON files on disk.

```go
import "github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"

provider := snapshot.NewFileProvider("/path/to/snapshots")
```

### Memory Provider (Built-in)

Stores snapshots in memory. Useful for testing.

```go
provider := snapshot.NewMemoryProvider()
```

### Redis Provider

Stores snapshots in Redis for distributed caching.

```go
import (
    "github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
    "github.com/redis/go-redis/v9"
    "time"
)

client := redis.NewClient(&redis.Options{
    Addr: "localhost:6379",
})

provider := snapshot.NewRedisProvider(snapshot.RedisOptions{
    Client: client,
    Prefix: "toggly",      // Default: "toggly"
    TTL:    24 * time.Hour, // Zero means no expiration
})
```

**Keys:**
- `{prefix}:definitions` - Feature definitions snapshot
- `{prefix}:jwks` - JWK set for signed definitions

### MongoDB Provider

Stores snapshots in MongoDB for high availability.

```go
import (
    "context"
    "github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
    "go.mongodb.org/mongo-driver/mongo"
    "go.mongodb.org/mongo-driver/mongo/options"
)

client, _ := mongo.Connect(context.Background(), options.Client().ApplyURI("mongodb://localhost:27017"))
collection := client.Database("toggly").Collection("snapshots")

provider := snapshot.NewMongoDBProvider(snapshot.MongoDBOptions{
    Collection:    collection,
    DefinitionsID: "toggly_definitions", // Default
    JWKSID:        "toggly_jwks",        // Default
})
```

**Documents:**
```json
{
    "_id": "toggly_definitions",
    "data": "...",
    "signature": "...",
    "kid": "...",
    "timestamp": 1234567890,
    "updatedAt": ISODate("...")
}
```

### PostgreSQL Provider

Stores snapshots in PostgreSQL.

```go
import (
    "database/sql"
    "github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
    _ "github.com/lib/pq"
)

db, _ := sql.Open("postgres", "postgres://user:pass@localhost/dbname?sslmode=disable")

provider := snapshot.NewPostgresProvider(snapshot.PostgresOptions{
    DB:              db,
    TableName:       "toggly_snapshots", // Default
    DefinitionsID:   "toggly_definitions",
    JWKSID:          "toggly_jwks",
    AutoCreateTable: true, // Default
})
```

**Table Schema:**
```sql
CREATE TABLE IF NOT EXISTS "toggly_snapshots" (
    id VARCHAR(100) NOT NULL PRIMARY KEY,
    data TEXT NOT NULL,
    signature VARCHAR(1000),
    kid VARCHAR(100),
    timestamp BIGINT,
    expiry BIGINT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### SQLite Provider

Stores snapshots in SQLite for local/embedded storage.

```go
import (
    "database/sql"
    "github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
    _ "github.com/mattn/go-sqlite3"
)

db, _ := sql.Open("sqlite3", "./toggly.db")

provider := snapshot.NewSQLiteProvider(snapshot.SQLiteOptions{
    DB:              db,
    TableName:       "toggly_snapshots", // Default
    DefinitionsID:   "toggly_definitions",
    JWKSID:          "toggly_jwks",
    AutoCreateTable: true, // Default
})
```

## Using with Toggly Client

```go
import (
    "github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly"
    "github.com/ops-ai/Toggly.FeatureManagement/toggly-go/toggly/snapshot"
)

// Create your preferred provider
provider := snapshot.NewRedisProvider(snapshot.RedisOptions{
    Client: redisClient,
})

// Configure Toggly with the provider
client, err := toggly.NewClient(toggly.Config{
    AppKey:           "your-app-key",
    Environment:      "production",
    SnapshotProvider: provider,
})
```

## Provider Interface

All providers implement the `snapshot.Provider` interface:

```go
type Provider interface {
    LoadDefinitions(ctx context.Context) (*DefinitionsSnapshot, error)
    SaveDefinitions(ctx context.Context, snap DefinitionsSnapshot) error
    Clear(ctx context.Context) error
    LoadJWKS(ctx context.Context) (*JWKSnap, error)
    SaveJWKS(ctx context.Context, snap JWKSnap) error
}
```

`DefinitionsSnapshot` includes `RawDefs` (exact signed defs JSON) and `ETag`
so signature verification does not re-serialize feature models after load.

## Custom Provider

You can implement your own provider for any storage backend:

```go
type MyProvider struct {
    // your fields
}

func (p *MyProvider) LoadDefinitions(ctx context.Context) (*snapshot.DefinitionsSnapshot, error) {
    // Load from your storage
}

func (p *MyProvider) SaveDefinitions(ctx context.Context, snap snapshot.DefinitionsSnapshot) error {
    // Save to your storage
}

func (p *MyProvider) Clear(ctx context.Context) error {
    // Delete definitions and JWKS snapshots
}

func (p *MyProvider) LoadJWKS(ctx context.Context) (*snapshot.JWKSnap, error) {
    // Load JWKS from your storage
}

func (p *MyProvider) SaveJWKS(ctx context.Context, snap snapshot.JWKSnap) error {
    // Save JWKS to your storage
}
```

## Dependencies

The providers require additional dependencies:

```bash
# Redis
go get github.com/redis/go-redis/v9

# MongoDB
go get go.mongodb.org/mongo-driver/mongo

# PostgreSQL
go get github.com/lib/pq

# SQLite
go get github.com/mattn/go-sqlite3
```

## License

MIT License
