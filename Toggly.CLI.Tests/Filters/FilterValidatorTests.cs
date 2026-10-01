using Toggly.CLI.Filters;
using Toggly.CLI.Models;
using Xunit;

namespace Toggly.CLI.Tests.Filters;

public class FilterValidatorTests
{
    [Fact]
    public void Validate_AcceptsKnownFiltersWithRequiredParameters()
    {
        var filters = new List<FeatureFilter>
        {
            new() { Name = "AlwaysOn", Parameters = new Dictionary<string, object>() },
            new() { Name = "Percentage", Parameters = new Dictionary<string, object> { ["Value"] = 50 } },
            new() { Name = "Targeting", Parameters = new Dictionary<string, object>() },
            new() { Name = "TimeWindow", Parameters = new Dictionary<string, object> { ["Start"] = "2020-01-01T00:00:00Z" } },
        };

        var errors = FilterValidator.Validate(filters);

        Assert.Empty(errors);
    }

    [Theory]
    [InlineData("ContextProperty")]
    [InlineData("UserClaims")]
    [InlineData("BrowserLanguage")]
    [InlineData("OS")]
    [InlineData("BrowserFamily")]
    [InlineData("Country")]
    [InlineData("DeviceType")]
    public void Validate_RecognizesHybridCatalogNames(string name)
    {
        Assert.True(StandardFilterCatalog.IsKnown(name));
    }

    [Fact]
    public void Validate_RejectsUnknownFilterName()
    {
        var filters = new List<FeatureFilter> { new() { Name = "NotARealFilter" } };

        var errors = FilterValidator.Validate(filters);

        Assert.Single(errors);
        Assert.Contains("Unknown filter name", errors[0]);
    }

    [Fact]
    public void Validate_RejectsOperatingSystemAsFilterName()
    {
        // "OperatingSystem" is the array *parameter* carried inside the "OS" filter,
        // not a filter name on its own. See StandardFilters/OS in Startup.cs.
        var filters = new List<FeatureFilter> { new() { Name = "OperatingSystem", Parameters = new Dictionary<string, object>() } };

        var errors = FilterValidator.Validate(filters);

        Assert.Single(errors);
        Assert.Contains("Unknown filter name 'OperatingSystem'", errors[0]);
    }

    [Theory]
    [InlineData("BrowserLanguage", "BrowserLanguage")]
    [InlineData("OS", "OperatingSystem")]
    [InlineData("BrowserFamily", "BrowserFamily")]
    [InlineData("Country", "Country")]
    [InlineData("DeviceType", "DeviceType")]
    public void Validate_AcceptsBrowserOrDeviceFilterWithRequiredArrayParameter(string filterName, string parameterName)
    {
        var filters = new List<FeatureFilter>
        {
            new() { Name = filterName, Parameters = new Dictionary<string, object> { [parameterName] = new[] { "a" } } }
        };

        var errors = FilterValidator.Validate(filters);

        Assert.Empty(errors);
    }

    [Theory]
    [InlineData("BrowserLanguage", "BrowserLanguage")]
    [InlineData("OS", "OperatingSystem")]
    [InlineData("BrowserFamily", "BrowserFamily")]
    [InlineData("Country", "Country")]
    [InlineData("DeviceType", "DeviceType")]
    public void Validate_RejectsBrowserOrDeviceFilterMissingRequiredArrayParameter(string filterName, string parameterName)
    {
        var filters = new List<FeatureFilter> { new() { Name = filterName, Parameters = new Dictionary<string, object>() } };

        var errors = FilterValidator.Validate(filters);

        Assert.Single(errors);
        Assert.Contains($"missing required parameter '{parameterName}'", errors[0]);
    }

    [Fact]
    public void Validate_AcceptsUserClaimsWithClaimAndValue()
    {
        var filters = new List<FeatureFilter>
        {
            new() { Name = "UserClaims", Parameters = new Dictionary<string, object> { ["Claim"] = "role", ["Value"] = "admin" } }
        };

        var errors = FilterValidator.Validate(filters);

        Assert.Empty(errors);
    }

    [Fact]
    public void Validate_RejectsUserClaimsMissingClaimOrValue()
    {
        var filters = new List<FeatureFilter> { new() { Name = "UserClaims", Parameters = new Dictionary<string, object>() } };

        var errors = FilterValidator.Validate(filters);

        Assert.Equal(2, errors.Count);
        Assert.Contains(errors, e => e.Contains("missing required parameter 'Claim'"));
        Assert.Contains(errors, e => e.Contains("missing required parameter 'Value'"));
    }

    [Fact]
    public void Validate_RejectsMissingRequiredParameter()
    {
        var filters = new List<FeatureFilter> { new() { Name = "Percentage", Parameters = new Dictionary<string, object>() } };

        var errors = FilterValidator.Validate(filters);

        Assert.Single(errors);
        Assert.Contains("missing required parameter 'Value'", errors[0]);
    }

    [Fact]
    public void Validate_RejectsTimeWindowWithoutStartOrEnd()
    {
        var filters = new List<FeatureFilter> { new() { Name = "TimeWindow", Parameters = new Dictionary<string, object>() } };

        var errors = FilterValidator.Validate(filters);

        Assert.Contains(errors, e => e.Contains("at least one of 'Start' or 'End'"));
    }

    [Fact]
    public void Validate_RejectsOutOfRangePercentageValue()
    {
        var filters = new List<FeatureFilter>
        {
            new() { Name = "Percentage", Parameters = new Dictionary<string, object> { ["Value"] = 150 } }
        };

        var errors = FilterValidator.Validate(filters);

        Assert.Contains(errors, e => e.Contains("between 0 and 100"));
    }

    [Fact]
    public void Validate_RequiresContextPropertyParameters()
    {
        var filters = new List<FeatureFilter> { new() { Name = "ContextProperty", Parameters = new Dictionary<string, object>() } };

        var errors = FilterValidator.Validate(filters);

        Assert.Equal(4, errors.Count);
    }

    [Fact]
    public void Validate_RejectsMissingFilterName()
    {
        var filters = new List<FeatureFilter> { new() { Name = "" } };

        var errors = FilterValidator.Validate(filters);

        Assert.Contains(errors, e => e.Contains("Filter name is required"));
    }

    [Fact]
    public void TryParseAndValidate_ReturnsFalseOnInvalidJson()
    {
        var ok = FilterValidator.TryParseAndValidate("not json", out var filters, out var error);

        Assert.False(ok);
        Assert.Empty(filters);
        Assert.Contains("Error parsing filters", error);
    }

    [Fact]
    public void TryParseAndValidate_ReturnsFalseWhenCatalogValidationFails()
    {
        var ok = FilterValidator.TryParseAndValidate("""[{"name":"Bogus","parameters":{}}]""", out var filters, out var error);

        Assert.False(ok);
        Assert.NotEmpty(filters);
        Assert.Contains("Unknown filter name", error);
    }

    [Fact]
    public void TryParseAndValidate_ReturnsTrueForCanonicalShapes()
    {
        const string json = """
            [
              {"name":"AlwaysOn","parameters":{}},
              {"name":"Percentage","parameters":{"Value":50}},
              {"name":"Targeting","parameters":{"Audience.Users:0":"alice","Audience.DefaultRolloutPercentage":25,"IgnoreCase":true}},
              {"name":"TimeWindow","parameters":{"Start":"2020-01-01T00:00:00Z","End":"2099-12-31T23:59:59Z"}}
            ]
            """;

        var ok = FilterValidator.TryParseAndValidate(json, out var filters, out var error);

        Assert.True(ok, error);
        Assert.Equal(4, filters.Count);
    }

    [Fact]
    public void TryParseAndValidate_AcceptsOSAndCountryFilters()
    {
        const string json = """
            [
              {"name":"OS","parameters":{"OperatingSystem":["windows","macos"]}},
              {"name":"Country","parameters":{"Country":["US","CA"]}}
            ]
            """;

        var ok = FilterValidator.TryParseAndValidate(json, out var filters, out var error);

        Assert.True(ok, error);
        Assert.Equal(2, filters.Count);
    }
}
