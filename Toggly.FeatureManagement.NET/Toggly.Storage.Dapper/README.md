# Toggly Dapper Snapshot Provider

Lightweight, high-performance Dapper-based snapshot provider for Toggly Feature Management. Stores feature flag snapshots in SQL databases using raw SQL queries for optimal performance.

## Installation

```bash
dotnet add package Toggly.FeatureManagement.Storage.Dapper
```

You'll also need to install the appropriate ADO.NET provider for your database:

```bash
# SQL Server
dotnet add package Microsoft.Data.SqlClient

# PostgreSQL
dotnet add package Npgsql

# MySQL
dotnet add package MySqlConnector

# SQLite
dotnet add package Microsoft.Data.Sqlite
```

## Usage

### SQL Server

```csharp
using Toggly.FeatureManagement.Storage.Dapper.Configuration;
using Microsoft.Data.SqlClient;

services.AddTogglyDapperSnapshotProvider(
    () => new SqlConnection(Configuration.GetConnectionString("DefaultConnection")),
    options => options.Provider = DatabaseProvider.SqlServer
);

// Then configure Toggly as usual
services.AddTogglyFeatureManagement(options => {
    options.AppKey = "your-app-key";
    options.Environment = "production";
});
```

### PostgreSQL

```csharp
using Npgsql;

services.AddTogglyDapperSnapshotProvider(
    () => new NpgsqlConnection(Configuration.GetConnectionString("PostgresConnection")),
    options => options.Provider = DatabaseProvider.PostgreSql
);
```

### MySQL

```csharp
using MySqlConnector;

services.AddTogglyDapperSnapshotProvider(
    () => new MySqlConnection(Configuration.GetConnectionString("MySqlConnection")),
    options => options.Provider = DatabaseProvider.MySql
);
```

### SQLite

```csharp
using Microsoft.Data.Sqlite;

services.AddTogglyDapperSnapshotProvider(
    () => new SqliteConnection("Data Source=toggly.db"),
    options => options.Provider = DatabaseProvider.Sqlite
);
```

### With Custom Settings

```csharp
services.AddTogglyDapperSnapshotProvider(
    () => new SqlConnection(connectionString),
    options => {
        options.Provider = DatabaseProvider.SqlServer;
        options.TableName = "MyFeatureSnapshots";    // Default: "TogglySnapshots"
        options.DocumentName = "my_features";        // Default: "toggly_features"
        options.JwkDocumentName = "my_jwks";         // Default: "toggly_jwks"
        options.AutoCreateTable = true;              // Default: true
    }
);
```

### Using Existing Connection Factory

If you've already registered a connection factory:

```csharp
// Register connection factory separately
services.AddSingleton<Func<IDbConnection>>(() =>
    new SqlConnection(Configuration.GetConnectionString("DefaultConnection"))
);

// Then just add the snapshot provider
services.AddTogglyDapperSnapshotProvider(
    options => options.Provider = DatabaseProvider.SqlServer
);
```

## Table Schema

The provider creates a single table (default: `TogglySnapshots`) with the following schema:

| Column | Type | Description |
|--------|------|-------------|
| Id | VARCHAR(100) | Primary key (document name) |
| Data | TEXT/NVARCHAR(MAX) | JSON serialized snapshot data |
| Signature | VARCHAR(1000) | Signature for signed definitions |
| KeyId | VARCHAR(100) | Key ID for signature verification |
| Timestamp | BIGINT | Unix timestamp of the snapshot |
| UpdatedAt | DATETIME | Last update time |

### Manual Table Creation

If you prefer to create the table manually, here are the scripts for each database:

#### SQL Server

```sql
CREATE TABLE [TogglySnapshots] (
    [Id] NVARCHAR(100) NOT NULL PRIMARY KEY,
    [Data] NVARCHAR(MAX) NOT NULL,
    [Signature] NVARCHAR(1000) NULL,
    [KeyId] NVARCHAR(100) NULL,
    [Timestamp] BIGINT NULL,
    [UpdatedAt] DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
```

#### PostgreSQL

```sql
CREATE TABLE "TogglySnapshots" (
    "Id" VARCHAR(100) NOT NULL PRIMARY KEY,
    "Data" TEXT NOT NULL,
    "Signature" VARCHAR(1000) NULL,
    "KeyId" VARCHAR(100) NULL,
    "Timestamp" BIGINT NULL,
    "UpdatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

#### MySQL

```sql
CREATE TABLE `TogglySnapshots` (
    `Id` VARCHAR(100) NOT NULL PRIMARY KEY,
    `Data` LONGTEXT NOT NULL,
    `Signature` VARCHAR(1000) NULL,
    `KeyId` VARCHAR(100) NULL,
    `Timestamp` BIGINT NULL,
    `UpdatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

#### SQLite

```sql
CREATE TABLE "TogglySnapshots" (
    "Id" TEXT NOT NULL PRIMARY KEY,
    "Data" TEXT NOT NULL,
    "Signature" TEXT NULL,
    "KeyId" TEXT NULL,
    "Timestamp" INTEGER NULL,
    "UpdatedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| Provider | DatabaseProvider | SqlServer | Database type for SQL dialect |
| TableName | string | "TogglySnapshots" | Name of the snapshots table |
| DocumentName | string | "toggly_features" | ID for the feature snapshot document |
| JwkDocumentName | string | "toggly_jwks" | ID for the JWK snapshot document |
| AutoCreateTable | bool | true | Automatically create table if it doesn't exist |

## Supported Databases

| Database | Enum Value | Tested Versions |
|----------|------------|-----------------|
| SQL Server | `DatabaseProvider.SqlServer` | 2016+ |
| PostgreSQL | `DatabaseProvider.PostgreSql` | 12+ |
| MySQL/MariaDB | `DatabaseProvider.MySql` | 5.7+/10.3+ |
| SQLite | `DatabaseProvider.Sqlite` | 3.x |

## Related Packages

- [Toggly.FeatureManagement](https://www.nuget.org/packages/Toggly.FeatureManagement/) - Core feature management library
- [Toggly.FeatureManagement.Storage.EntityFramework](https://www.nuget.org/packages/Toggly.FeatureManagement.Storage.EntityFramework/) - Entity Framework Core provider
- [Toggly.FeatureManagement.Storage.RavenDB](https://www.nuget.org/packages/Toggly.FeatureManagement.Storage.RavenDB/) - RavenDB provider

## License

MIT License - see [LICENSE](../LICENSE) for details.
