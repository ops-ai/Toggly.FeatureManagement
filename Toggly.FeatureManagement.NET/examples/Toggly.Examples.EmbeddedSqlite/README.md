# Toggly Embedded SQLite consumer sample

This minimal ASP.NET Core application consumes the embedded Dashboard and the
Entity Framework catalog store through project references. It has no cloud
Toggly registration, SDK key, or outbound Toggly connection.

Run it from the SDK solution directory:

```bash
dotnet run --project examples/Toggly.Examples.EmbeddedSqlite
```

Open `http://localhost:5000/internal/features` to initialize a catalog and
manage features. The Dashboard uses its loopback-only fallback in this sample;
a deployed host should attach an explicit authorization policy to
`MapTogglyDashboard`.

Before `Run()` starts the web host, `Program.cs` explicitly creates the sample's dedicated `toggly.embedded.db` database through `TogglyCatalogDbContext`. That initialization is deliberately sample-only. A production host must provision `TogglyCatalogs` with the package's matching catalog-only schema script or an equivalent migration; the catalog-store package does not call `EnsureCreated()`.
