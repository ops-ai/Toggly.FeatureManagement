using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class AlwaysOnFeatureFilterTests
{
    [Fact]
    public async Task AlwaysOn_ReturnsTrue()
    {
        var filter = new AlwaysOnFeatureFilter();
        var result = await filter.EvaluateAsync(new FeatureFilterEvaluationContext());
        result.Should().BeTrue();
    }
}
