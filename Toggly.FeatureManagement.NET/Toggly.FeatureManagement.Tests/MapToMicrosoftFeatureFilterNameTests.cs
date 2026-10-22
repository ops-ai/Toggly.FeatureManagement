using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using FluentAssertions;
using Toggly.FeatureManagement.Data;
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
    [InlineData("Country", "CountryFamily")]
    [InlineData("country", "CountryFamily")]
    [InlineData("OperatingSystem", "OS")]
    [InlineData("operatingsystem", "OS")]
    public void MapsSegmentFilterAliases(string input, string expected)
    {
        TogglyFeatureProvider.MapToMicrosoftFeatureFilterName(input).Should().Be(expected);
    }

    [Theory]
    [InlineData("AlwaysOn")]
    [InlineData("UserClaims")]
    [InlineData("BrowserFamily")]
    [InlineData("OS")]
    [InlineData("CountryFamily")]
    [InlineData("CustomFilter")]
    public void LeavesOtherFilterNamesUnchanged(string input)
    {
        TogglyFeatureProvider.MapToMicrosoftFeatureFilterName(input).Should().Be(input);
    }

    [Fact]
    public void CountryWireName_FromFilterParityFixture_MapsToCountryFamily()
    {
        var fixturePath = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..", "..",
            "docs", "filter-parity", "fixtures", "country-from-request.json"));
        File.Exists(fixturePath).Should().BeTrue("filter-parity fixture must be present");

        using var document = JsonDocument.Parse(File.ReadAllText(fixturePath));
        var filterName = document.RootElement.GetProperty("filters")[0].GetProperty("name").GetString();
        filterName.Should().Be("Country");
        TogglyFeatureProvider.MapToMicrosoftFeatureFilterName(filterName).Should().Be("CountryFamily");
    }

    [Fact]
    public void BuildFeatureDefinition_WithCountryFilterName_UsesCountryFamilyRegistration()
    {
        var model = new Data.FeatureDefinitionModel
        {
            FeatureKey = "filter-country",
            Filters =
            [
                new Data.FeatureFilter
                {
                    Name = "Country",
                    Parameters = new Dictionary<string, string>
                    {
                        ["Country:0"] = "US",
                        ["Percentage"] = "100"
                    }
                }
            ]
        };

        var definition = TogglyFeatureProvider.BuildFeatureDefinition(model);
        definition.EnabledFor.Should().ContainSingle(f => f.Name == "CountryFamily");
    }

    [Fact]
    public void NullOrEmpty_ReturnsEmpty()
    {
        TogglyFeatureProvider.MapToMicrosoftFeatureFilterName(null).Should().BeEmpty();
        TogglyFeatureProvider.MapToMicrosoftFeatureFilterName("").Should().BeEmpty();
    }
}
