# Toggly Embedded SQLite consumer sample

This minimal ASP.NET Core application consumes the embedded runtime and the Entity Framework catalog store through project references. It has no cloud Toggly registration, SDK key, or outbound Toggly connection.

Run it from the SDK solution directory:

```bash
dotnet run --project examples/Toggly.Examples.EmbeddedSqlite
```

Before `Run()` starts the web host, `Program.cs` explicitly creates the sample's dedicated `toggly.embedded.db` database through `TogglyCatalogDbContext`. That initialization is deliberately sample-only. A production host must provision `TogglyCatalogs` with the package's matching catalog-only schema script or an equivalent migration; the catalog-store package does not call `EnsureCreated()`.
