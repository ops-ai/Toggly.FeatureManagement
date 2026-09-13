using Microsoft.EntityFrameworkCore;
using Toggly.FeatureManagement.Dashboard;
using Toggly.FeatureManagement.Storage.EntityFramework;
using Toggly.FeatureManagement.Storage.EntityFramework.Configuration;

var builder = WebApplication.CreateBuilder(args);
var catalogConnection = builder.Configuration.GetConnectionString("TogglyCatalog") ?? "Data Source=toggly.embedded.db";

builder.Services.AddTogglyEntityFrameworkCatalogStore(options => options.UseSqlite(catalogConnection));
builder.Services.AddTogglyDashboard(options => options.CatalogName = "EmbeddedSqliteSample");

var app = builder.Build();

// This explicit sample setup happens before the application begins serving requests.
// Production applications should apply the catalog-only schema script or their own migration instead.
await using (var scope = app.Services.CreateAsyncScope())
{
    var catalogFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<TogglyCatalogDbContext>>();
    await using var catalogContext = await catalogFactory.CreateDbContextAsync();
    await catalogContext.Database.EnsureCreatedAsync();
}

app.MapGet("/", () => Results.Ok(new { name = "Toggly Embedded SQLite sample", catalog = "EmbeddedSqliteSample" }));
app.MapTogglyDashboard("/internal/features");

app.Run();

public partial class Program;
