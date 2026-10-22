using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class AlwaysOnAlwaysOffFeatureFilterTests
{
    [Fact]
    public async Task AlwaysOn_ReturnsTrue()
    {
        var filter = new AlwaysOnFeatureFilter();
        var result = await filter.EvaluateAsync(CreateContext("flag"));
        result.Should().BeTrue();
    }

    [Fact]
    public async Task AlwaysOff_ReturnsFalse()
    {
        var filter = new AlwaysOffFeatureFilter();
        var result = await filter.EvaluateAsync(CreateContext("flag"));
        result.Should().BeFalse();
    }

    private static FeatureFilterEvaluationContext CreateContext(string featureName) =>
        new()
        {
            FeatureName = featureName,
            Parameters = new ConfigurationBuilder().Build()
        };
}
