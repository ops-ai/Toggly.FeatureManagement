using FluentAssertions;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Dashboard;
using Xunit;

namespace Toggly.FeatureManagement.Dashboard.Tests;

public sealed class DashboardRuleInputWireNameTests
{
    [Theory]
    [InlineData("Country")]
    [InlineData("CountryFamily")]
    public void FromRule_ToRule_PreservesIndexedCountryValues(string filterName)
    {
        var rule = new CatalogRule
        {
            Name = filterName,
            Parameters = new Dictionary<string, string>
            {
                ["Country:0"] = "US",
                ["Percentage"] = "100"
            }
        };

        var input = DashboardRuleInput.FromRule(rule);
        input.Values.Should().Be("US");

        var roundTrip = input.ToRule();
        roundTrip.Parameters.Should().Contain(new KeyValuePair<string, string>("Country:0", "US"));
        roundTrip.Parameters.Should().Contain(new KeyValuePair<string, string>("Percentage", "100"));
    }

    [Theory]
    [InlineData("OS")]
    [InlineData("OperatingSystem")]
    public void FromRule_ToRule_PreservesIndexedOperatingSystemValues(string filterName)
    {
        var rule = new CatalogRule
        {
            Name = filterName,
            Parameters = new Dictionary<string, string>
            {
                ["OperatingSystem:0"] = "Windows",
                ["Percentage"] = "100"
            }
        };

        var input = DashboardRuleInput.FromRule(rule);
        input.Values.Should().Be("Windows");

        var roundTrip = input.ToRule();
        roundTrip.Parameters.Should().Contain(new KeyValuePair<string, string>("OperatingSystem:0", "Windows"));
    }
}
