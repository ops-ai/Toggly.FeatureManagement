# Toggly MongoDB Snapshot Provider

MongoDB snapshot provider for Toggly Feature Management. Stores feature flag snapshots in MongoDB for high availability and horizontal scalability.

## Installation

```bash
dotnet add package Toggly.FeatureManagement.Storage.MongoDB
```

## Usage

### Basic Setup

```csharp
using Toggly.FeatureManagement.Storage.MongoDB.Configuration;

services.AddTogglyMongoDBSnapshotProvider(
    Configuration.GetConnectionString("MongoDB")
);

// Then configure Toggly as usual
services.AddTogglyFeatureManagement(options => {
    options.AppKey = "your-app-key";
    options.Environment = "production";
});
```

### With Custom Settings

```csharp
services.AddTogglyMongoDBSnapshotProvider(
    "mongodb://localhost:27017",
    options => {
        options.DatabaseName = "my_app";           // Default: "toggly"
        options.CollectionName = "feature_flags";  // Default: "snapshots"
        options.DocumentName = "my_features";      // Default: "toggly_features"
        options.JwkDocumentName = "my_jwks";       // Default: "toggly_jwks"
    }
);
```

### With MongoClient Settings

```csharp
var clientSettings = MongoClientSettings.FromConnectionString(connectionString);
clientSettings.ServerApi = new ServerApi(ServerApiVersion.V1);
clientSettings.MaxConnectionPoolSize = 100;

services.AddTogglyMongoDBSnapshotProvider(clientSettings, options => {
    options.DatabaseName = "toggly";
    options.CollectionName = "snapshots";
});
```

### With Existing MongoClient

```csharp
var mongoClient = new MongoClient("mongodb://localhost:27017");

services.AddTogglyMongoDBSnapshotProvider(mongoClient, options => {
    options.DatabaseName = "toggly";
});
```

### Using Existing Registration

If you've already registered `IMongoClient`:

```csharp
// Register MongoDB client separately
services.AddSingleton<IMongoClient>(sp =>
    new MongoClient(Configuration.GetConnectionString("MongoDB"))
);

// Then just add the snapshot provider
services.AddTogglyMongoDBSnapshotProvider();
```

## Document Schema

The provider stores snapshots as documents in the configured collection:

```json
{
    "_id": "toggly_features",
    "data": "{ ... serialized JSON ... }",
    "signature": "...",
    "keyId": "key-123",
    "timestamp": 1234567890,
    "updatedAt": ISODate("2024-01-15T10:30:00Z")
}
```

| Field | Type | Description |
|-------|------|-------------|
| _id | String | Document identifier (toggly_features or toggly_jwks) |
| data | String | JSON serialized snapshot data |
| signature | String | Signature for signed definitions (nullable) |
| keyId | String | Key ID for signature verification (nullable) |
| timestamp | Int64 | Unix timestamp of the snapshot |
| updatedAt | DateTime | Last update time |

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| DatabaseName | string | "toggly" | MongoDB database name |
| CollectionName | string | "snapshots" | Collection name for snapshots |
| DocumentName | string | "toggly_features" | ID for the feature snapshot document |
| JwkDocumentName | string | "toggly_jwks" | ID for the JWK snapshot document |

## MongoDB Connection String Examples

### Local Development

```
mongodb://localhost:27017
```

### Replica Set

```
mongodb://host1:27017,host2:27017,host3:27017/?replicaSet=myReplicaSet
```

### MongoDB Atlas

```
mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority
```

### With Authentication

```
mongodb://user:password@localhost:27017/admin
```

## Index Recommendations

For optimal performance, consider creating an index on the `_id` field (automatic) and the `updatedAt` field:

```javascript
db.snapshots.createIndex({ "updatedAt": -1 })
```

## Related Packages

- [Toggly.FeatureManagement](https://www.nuget.org/packages/Toggly.FeatureManagement/) - Core feature management library
- [Toggly.FeatureManagement.Storage.RavenDB](https://www.nuget.org/packages/Toggly.FeatureManagement.Storage.RavenDB/) - RavenDB provider
- [Toggly.FeatureManagement.Storage.Dapper](https://www.nuget.org/packages/Toggly.FeatureManagement.Storage.Dapper/) - Dapper/SQL provider

## License

MIT License - see [LICENSE](../LICENSE) for details.
