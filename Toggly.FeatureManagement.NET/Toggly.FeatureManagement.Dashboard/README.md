# Toggly Embedded Dashboard

Add an offline feature-management dashboard to an ASP.NET Core 8 or later host.
Features are evaluated by the existing Toggly .NET SDK. The dashboard needs no
Toggly account, service connection, frontend build, or telemetry. It manages one
application and one logical environment, `Production`, without a feature-count
license limit.

## SQLite setup

Install `Toggly.FeatureManagement.Dashboard`,
`Toggly.FeatureManagement.Storage.EntityFramework`, and the EF Core SQLite
provider matching your EF Core version. Choose a stable catalog name explicitly,
especially when sharing storage between replicas.

```csharp
using Microsoft.EntityFrameworkCore;
using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Dashboard;
using Toggly.FeatureManagement.Storage.EntityFramework.Configuration;
using Toggly.FeatureManagement.Web;

builder.Services.AddTogglyEntityFrameworkCatalogStore(
    database => database.UseSqlite("Data Source=toggly.db"));

builder.Services.AddTogglyDashboard(options =>
{
    options.CatalogName = "Orders";
}).WithTogglyTargeting<HttpContextTargetingContextAccessor>();

// Keep the host's existing authentication schemes and FeatureAdmins policy.
var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.MapTogglyDashboard("/internal/features")
   .RequireAuthorization("FeatureAdmins");
app.Run();
```

Apply the provider's catalog-only schema script before starting the host. The
package never calls `EnsureCreated` or modifies arbitrary host schemas. The
dedicated SQLite sample initializes its own database explicitly. Catalog content
is initialized separately through the dashboard's Initialize or Import action.

Use `IFeatureManager` and `IFeatureManagerSnapshot` as with the normal SDK. New
features start disabled. Turn a feature on from the list, add at least one
filter (Always On is the default Add user filter choice), and save conditions.
Saving an enabled feature with no filters is rejected. Turning a feature off
and saving clears its targeting filters. Deleting a feature makes it evaluate
false.

Manage reusable identifier lists on the Lists tab, then link one list per
Targeting slot (users, groups, exclusions). The catalog stores list keys;
evaluation expands them to indexed IDs.

## Access and deployment

Attach a host authorization policy to the mapping. It covers pages, POSTs,
assets, exports, and import previews. The package preserves host authentication
and Data Protection configuration. Every POST requires an antiforgery token.

Without explicit authorization metadata, access is limited to direct loopback
requests without forwarding or original-forwarding headers. Deployments behind
a proxy must configure an explicit policy. Localhost cannot establish the
identity of a user behind a proxy. Anonymous dashboard metadata is not allowed.

One mount is supported; `/` is rejected. Nested mounts and host `PathBase` are
supported. Assets are bundled and protected under the selected mount.

Set `ReadOnly=true` to disable mutation routes. A read-only storage registration
cannot be mounted as an editable dashboard. Replicas or workers can use
`AddTogglyEmbedded` without MVC or any dashboard mapping.

Storage is required explicitly: choose the Entity Framework, RavenDB, or
DistributedCache catalog store alongside its existing snapshot registration APIs.
RavenDB uses the host's `IDocumentStore`. DistributedCache requires exactly one
`SingleWriter` process per catalog; other processes use `Reader`. Its local writer
gate does not provide distributed compare-and-swap. Cache persistence and eviction
are the host's responsibility. The package adds no cache expiration.

## Targeting and contexts

The dashboard uses Toggly's existing percentage, targeting, schedule, entity,
browser, language, OS, device, country, and claim filters. Country matching uses
host request information and makes no GeoIP request. Enter actual SDK filter
values. Create reusable lists on the Lists tab, then link one list per Targeting
slot. Tags use one value per line so literal commas are preserved.

The built-in HTTP targeting accessor uses `User.Identity.Name` and `"group"`
claims. Preserve that accessor or your custom accessor when moving to SaaS.
Registered entity contexts are offered in the editor and retained in the catalog
when referenced. User/web rules combine with their Any/All setting; entity rules
use their separate setting, falling back to the user setting. If both groups
exist, both must match. Evaluation without the required entity fails closed.

## Backups, imports, and recovery

Export reads authoritative storage and includes disabled features' retained rules.
It does not export credentials, connection settings, runtime objects, catalog
names, or revision tokens. Treat a catalog backup as application configuration.

Import validates the complete file and previews adds, identical features, existing
key conflicts, and context conflicts. New keys are selected by default; updates
require explicit selection. Imports merge and never delete omitted features.
Imported lists overlay existing lists by key; lists used only by the target catalog
are kept.
Compatible context properties merge additively. Case-only key changes and
incompatible context types are rejected. Apply revalidates against the previewed
revision; a concurrent edit requires a new preview.

The default poll interval and initial read timeout are five seconds. The default
catalog/import limit is 10 MiB, configurable through `MaxCatalogBytes`. Errors
never truncate content or automatically reset storage. A failed refresh retains
the last valid runtime snapshot and disables dashboard writes until recovery.
Restore missing storage from a backup before restarting an already-loaded catalog.
The Storage page shows the active revision, refresh time, and storage/writer mode.

When switching to Toggly Cloud, export and import into the destination application
and environment, resolve conflicts and approvals, and verify publication. Replace
embedded registration with `AddTogglyWeb` or `AddToggly`, configure a backend SDK key
and environment, preserve targeting accessors and context registration, and remove
the dashboard mapping. Never register local and cloud definition providers
together. Keep the local catalog backup for rollback.

Licensed under MIT. CSS and JavaScript are bundled with the package; no Node or
frontend compilation is required by package consumers.
