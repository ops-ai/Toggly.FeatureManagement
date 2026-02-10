# Toggly Entity Framework Snapshot Provider

Entity Framework Core snapshot provider for Toggly Feature Management. Stores feature flag snapshots in any database supported by Entity Framework Core (SQL Server, PostgreSQL, MySQL, SQLite, etc.).

## Installation

```bash
dotnet add package Toggly.FeatureManagement.Storage.EntityFramework
```

You'll also need to install the appropriate EF Core database provider for your database:

```bash
# SQL Server
dotnet add package Microsoft.EntityFrameworkCore.SqlServer

# PostgreSQL
dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL

# MySQL
dotnet add package Pomelo.EntityFrameworkCore.MySql

# SQLite
dotnet add package Microsoft.EntityFrameworkCore.Sqlite
```

## Usage

### Basic Setup

```csharp
using Toggly.FeatureManagement.Storage.EntityFramework.Configuration;

// In Program.cs or Startup.cs
services.AddTogglyEntityFrameworkSnapshotProvider(
    options => options.UseSqlServer(Configuration.GetConnectionString("DefaultConnection"))
);

// Then configure Toggly as usual
services.AddTogglyFeatureManagement(options => {
    options.AppKey = "your-app-key";
    options.Environment = "production";
});
```

### With Custom Settings

```csharp
services.AddTogglyEntityFrameworkSnapshotProvider(
    options => options.UseSqlServer(Configuration.GetConnectionString("DefaultConnection")),
    settings => {
        settings.DocumentName = "my_features";      // Default: "toggly_features"
        settings.JwkDocumentName = "my_jwks";       // Default: "toggly_jwks"
        settings.AutoCreateTable = true;            // Default: true
    }
);
```

### With Existing DbContext Registration

If you've already registered `TogglyEntities` in your DI container:

```csharp
// Register the DbContext separately
services.AddDbContext<TogglyEntities>(options =>
    options.UseNpgsql(Configuration.GetConnectionString("PostgresConnection"))
);

// Then just add the snapshot provider
services.AddTogglyEntityFrameworkSnapshotProvider();
```

### Database Examples

#### SQL Server

```csharp
services.AddTogglyEntityFrameworkSnapshotProvider(
    options => options.UseSqlServer("Server=localhost;Database=MyApp;Trusted_Connection=True;")
);
```

#### PostgreSQL

```csharp
services.AddTogglyEntityFrameworkSnapshotProvider(
    options => options.UseNpgsql("Host=localhost;Database=myapp;Username=user;Password=pass")
);
```

#### SQLite

```csharp
services.AddTogglyEntityFrameworkSnapshotProvider(
    options => options.UseSqlite("Data Source=toggly.db")
);
```

#### MySQL

```csharp
services.AddTogglyEntityFrameworkSnapshotProvider(
    options => options.UseMySql(
        "Server=localhost;Database=myapp;User=user;Password=pass;",
        ServerVersion.AutoDetect(connectionString)
    )
);
```

## Table Schema

The provider creates a single table `TogglySnapshots` with the following schema:

| Column | Type | Description |
|--------|------|-------------|
| Id | VARCHAR(100) | Primary key (document name) |
| Data | TEXT | JSON serialized snapshot data |
| Signature | VARCHAR(1000) | Signature for signed definitions |
| KeyId | VARCHAR(100) | Key ID for signature verification |
| Timestamp | BIGINT | Unix timestamp of the snapshot |
| UpdatedAt | DATETIME | Last update time |

## Auto Table Creation

By default, the provider will automatically create the table if it doesn't exist when `AutoCreateTable` is set to `true` (default).

If you prefer to manage database schema yourself, set `AutoCreateTable = false` and run the appropriate migration:

```sql
-- SQL Server
CREATE TABLE TogglySnapshots (
    Id NVARCHAR(100) NOT NULL PRIMARY KEY,
    Data NVARCHAR(MAX) NOT NULL,
    Signature NVARCHAR(1000) NULL,
    KeyId NVARCHAR(100) NULL,
    Timestamp BIGINT NULL,
    UpdatedAt DATETIME2 NOT NULL
);

-- PostgreSQL
CREATE TABLE "TogglySnapshots" (
    "Id" VARCHAR(100) NOT NULL PRIMARY KEY,
    "Data" TEXT NOT NULL,
    "Signature" VARCHAR(1000) NULL,
    "KeyId" VARCHAR(100) NULL,
    "Timestamp" BIGINT NULL,
    "UpdatedAt" TIMESTAMP NOT NULL
);
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| DocumentName | string | "toggly_features" | ID for the feature snapshot document |
| JwkDocumentName | string | "toggly_jwks" | ID for the JWK snapshot document |
| AutoCreateTable | bool | true | Automatically create table if it doesn't exist |

## Related Packages

- [Toggly.FeatureManagement](https://www.nuget.org/packages/Toggly.FeatureManagement/) - Core feature management library
- [Toggly.FeatureManagement.Storage.RavenDB](https://www.nuget.org/packages/Toggly.FeatureManagement.Storage.RavenDB/) - RavenDB snapshot provider
- [Toggly.FeatureManagement.Storage.DistributedCache](https://www.nuget.org/packages/Toggly.FeatureManagement.Storage.DistributedCache/) - Distributed cache snapshot provider

## License

MIT License - see [LICENSE](../LICENSE) for details.
