using FluentAssertions;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

/// <summary>
/// Unit tests for catalog short filter name → Microsoft.FeatureManagement alias mapping.
/// </summary>
public class MapToMicrosoftFeatureFilterNameTests
{
    [Theory]
    [InlineData("Percentage", "Microsoft.Percentage")]
    [InlineData("percentage", "Microsoft.Percentage")]
    [InlineData("PERCENTAGE", "Microsoft.Percentage")]
    [InlineData("Targeting", "Microsoft.Targeting")]
    [InlineData("targeting", "Microsoft.Targeting")]
    [InlineData("TimeWindow", "Microsoft.TimeWindow")]
    [InlineData("timewindow", "Microsoft.TimeWindow")]
    public void MapsShortNamesToMicrosoftAliases(string input, string expected)
    {
        TogglyFeatureProvider.MapToMicrosoftFeatureFilterName(input).Should().Be(expected);
    }

    [Theory]
    [InlineData("Microsoft.Percentage")]
    [InlineData("Microsoft.Targeting")]
    [InlineData("Microsoft.TimeWindow")]
    [InlineData("microsoft.percentage")]
    public void LeavesMicrosoftPrefixedNamesUnchanged(string input)
    {
        TogglyFeatureProvider.MapToMicrosoftFeatureFilterName(input).Should().Be(input);
    }

    [Theory]
    [InlineData("AlwaysOn")]
    [InlineData("UserClaims")]
    [InlineData("BrowserFamily")]
    [InlineData("OS")]
    [InlineData("Country")]
    [InlineData("CustomFilter")]
    public void LeavesOtherFilterNamesUnchanged(string input)
    {
        TogglyFeatureProvider.MapToMicrosoftFeatureFilterName(input).Should().Be(input);
    }

    [Fact]
    public void NullOrEmpty_ReturnsEmpty()
    {
        TogglyFeatureProvider.MapToMicrosoftFeatureFilterName(null).Should().BeEmpty();
        TogglyFeatureProvider.MapToMicrosoftFeatureFilterName("").Should().BeEmpty();
    }
}
