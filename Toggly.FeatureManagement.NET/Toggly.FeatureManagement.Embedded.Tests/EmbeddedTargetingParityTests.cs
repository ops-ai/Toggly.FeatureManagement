using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Embedded.Tests;

public sealed class EmbeddedTargetingParityTests
{
    [Theory]
    [InlineData("Audience.Exclusion.Users:0", "alice")]
    [InlineData("Audience.Exclusion.Groups:0", "staff")]
    public async Task CompiledTargeting_ExclusionsOverrideInclusion(string exclusionKey, string value)
    {
        var snapshot = new CatalogSnapshot
        {
            CatalogName = "Test", Revision = "one",
            Document = new() { Features = { new() { Key = "Checkout", Name = "Checkout", Enabled = true,
                Rules = { new() { Name = "Targeting", Parameters = new()
                {
                    ["Audience.Users:0"] = "alice", ["Audience.Groups:0"] = "staff",
                    ["Audience.DefaultRolloutPercentage"] = "100", ["IgnoreCase"] = "true", [exclusionKey] = value
                } } } } } }
        };
        var provider = new EmbeddedFeatureProvider();
        provider.Publish(EmbeddedCatalogCompiler.Compile(snapshot));
        var definition = await provider.GetFeatureDefinitionAsync("Checkout");
        var filter = Assert.Single(definition.EnabledFor);
        using var services = new ServiceCollection().AddSingleton<ITargetingContextAccessor>(new Accessor()).BuildServiceProvider();

        Assert.Equal("Microsoft.Targeting", filter.Name);
        Assert.False(await new TogglyTargetingFilter(services).EvaluateAsync(new FeatureFilterEvaluationContext { FeatureName = "Checkout", Parameters = filter.Parameters }));
    }

    private sealed class Accessor : ITargetingContextAccessor
    {
        public ValueTask<TargetingContext> GetContextAsync() => ValueTask.FromResult(new TargetingContext { UserId = "alice", Groups = ["staff"] });
    }
}
