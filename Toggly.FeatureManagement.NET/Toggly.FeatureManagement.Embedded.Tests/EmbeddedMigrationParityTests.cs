using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Context;
using Toggly.FeatureManagement.Data;
using Xunit;

namespace Toggly.FeatureManagement.Embedded.Tests;

public sealed class EmbeddedMigrationParityTests
{
    [Fact]
    public async Task Actual_SaaS_publication_preserves_evaluation_for_fixed_identities_and_entities()
    {
        var directory = Environment.GetEnvironmentVariable("TOGGLY_MIGRATION_EVIDENCE_DIRECTORY")
            ?? Path.Combine(AppContext.BaseDirectory, "Fixtures", "Migration");
        var catalog = CatalogJson.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "catalog.json")));
        using var published = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "published.json")));
        var jsonOptions = new JsonSerializerOptions { PropertyNameCaseInsensitive = true, Converters = { new JsonStringEnumConverter() } };
        var models = published.RootElement.GetProperty("definitions").Deserialize<List<FeatureDefinitionModel>>(jsonOptions)!;
        var embedded = EmbeddedCatalogCompiler.Compile(new() { CatalogName = "Migration", Revision = "local", Document = catalog });
        var cloud = new EmbeddedCompiledSnapshot("published", models.ToDictionary(model => model.FeatureKey),
            models.ToDictionary(model => model.FeatureKey, TogglyFeatureProvider.BuildFeatureDefinition));
        using var local = EvaluationServices(embedded);
        using var migrated = EvaluationServices(cloud);
        var provider = migrated.GetRequiredService<EmbeddedFeatureProvider>();
        Assert.True(provider.GetDebugInfo().Loaded);
        var names = new List<string>();
        await foreach (var definition in provider.GetAllFeatureDefinitionsAsync()) names.Add(definition.Name);
        Assert.Equal(catalog.Features.Select(feature => feature.Key).Order(), names.Order());
        var before = local.GetRequiredService<IFeatureManager>();
        var after = migrated.GetRequiredService<IFeatureManager>();
        foreach (var identity in new[] { "alice", "bob", "Alice", "anonymous" }.Concat(Enumerable.Range(0, 100).Select(i => "user-" + i)))
        {
            ((IdentityAccessor)local.GetRequiredService<ITargetingContextAccessor>()).UserId = identity;
            ((IdentityAccessor)migrated.GetRequiredService<ITargetingContextAccessor>()).UserId = identity;
            foreach (var key in catalog.Features.Select(feature => feature.Key).Append("Absent"))
            {
                Assert.Equal(await before.IsEnabledAsync(key), await after.IsEnabledAsync(key));
                foreach (var amount in new[] { 0m, 99m, 100m, 101m })
                    Assert.Equal(await before.IsEnabledAsync(key, new Order("order-1", amount)), await after.IsEnabledAsync(key, new Order("order-1", amount)));
            }
        }
        Assert.True(await after.IsEnabledAsync("Everyone"));
        Assert.False(await after.IsEnabledAsync("Disabled"));
        Assert.False(await after.IsEnabledAsync("Entity"));
        Assert.False(await after.IsEnabledAsync("Entity", new Order("order-1", 99m)));
        Assert.True(await after.IsEnabledAsync("Entity", new Order("order-1", 100m)));
    }

    private static ServiceProvider EvaluationServices(EmbeddedCompiledSnapshot snapshot)
    {
        var services = new ServiceCollection(); services.AddLogging();
        services.AddTogglyEntityContext<Order>("Order", order => order.Id, builder => builder.Property("Total", "number"));
        services.AddTogglyEmbedded().WithTogglyTargeting<IdentityAccessor>();
        var provider = services.BuildServiceProvider(); provider.GetRequiredService<EmbeddedFeatureProvider>().Publish(snapshot);
        return provider;
    }

    public sealed class IdentityAccessor : ITargetingContextAccessor
    {
        public string UserId { get; set; } = "alice";
        public ValueTask<TargetingContext> GetContextAsync() => ValueTask.FromResult(new TargetingContext { UserId = UserId, Groups = ["staff"] });
    }
    private sealed record Order(string Id, decimal Total);
}
