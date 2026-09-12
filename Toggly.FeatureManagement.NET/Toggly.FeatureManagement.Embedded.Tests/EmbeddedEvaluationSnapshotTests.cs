using FluentAssertions;
using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Embedded.Tests;

public class EmbeddedEvaluationSnapshotTests
{
    [Fact]
    public async Task EvaluationScope_UsesSameRawAndMicrosoftDefinitionsAfterConcurrentPublish()
    {
        var provider = new EmbeddedFeatureProvider();
        provider.Publish(EmbeddedCatalogCompiler.Compile(Snapshot("one", true)));
        var scopeProvider = (IEvaluationSnapshotScope)provider;

        using (scopeProvider.BeginScope())
        {
            provider.Publish(EmbeddedCatalogCompiler.Compile(Snapshot("two", false)));

            provider.TryGetFeatureModel("Feature", out var raw).Should().BeTrue();
            var microsoft = await provider.GetFeatureDefinitionAsync("Feature");
            raw!.Filters.Should().ContainSingle(filter => filter.Name == "AlwaysOn");
            microsoft.EnabledFor.Should().ContainSingle(filter => filter.Name == "AlwaysOn");
        }

        provider.TryGetFeatureModel("Feature", out var updated).Should().BeTrue();
        updated!.Filters.Should().BeEmpty();
    }

    private static CatalogSnapshot Snapshot(string revision, bool enabled) => new()
    {
        CatalogName = "Orders", Revision = revision, UpdatedAtUtc = DateTimeOffset.UtcNow,
        Document = new CatalogDocument { Features = { new CatalogFeature { Key = "Feature", Name = "Feature", Enabled = enabled } } }
    };
}
