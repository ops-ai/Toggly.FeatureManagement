using FluentAssertions;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Dashboard;
using Xunit;

namespace Toggly.FeatureManagement.Dashboard.Tests;

public sealed class FeatureFilterSummaryTests
{
    private static readonly CatalogList Users = new() { Key = "beta", Name = "Beta testers", Description = "", Items = { "alice" } };

    [Fact]
    public void Always_on_only_is_not_conditional()
    {
        var feature = Feature(true, Rule(DashboardRuleInput.AlwaysOn));
        FeatureFilterSummary.IsConditional(feature).Should().BeFalse();
        FeatureFilterSummary.Lines(feature, []).Should().BeEmpty();
    }

    [Fact]
    public void Disabled_features_are_not_conditional()
    {
        var feature = Feature(false, Rule(DashboardRuleInput.FilterPercentage, "Value", "10"));
        FeatureFilterSummary.IsConditional(feature).Should().BeFalse();
    }

    [Fact]
    public void Percentage_line_uses_saas_copy()
    {
        var feature = Feature(true, Rule(DashboardRuleInput.FilterPercentage, "Value", "10"));
        FeatureFilterSummary.IsConditional(feature).Should().BeTrue();
        FeatureFilterSummary.Lines(feature, []).Should().Equal("for 10% of users");
    }

    [Fact]
    public void Targeting_lines_prefer_list_names()
    {
        var rule = Rule(DashboardRuleInput.Targeting, "Audience.Users", "beta", "Audience.Exclusion.Groups", "missing");
        FeatureFilterSummary.Lines(Feature(true, rule), [Users]).Should().Equal("for Beta testers (Users), for missing (Excluded groups)");
    }

    [Fact]
    public void Time_window_formats_roundtrip_dates()
    {
        var rule = Rule(DashboardRuleInput.TimeWindow, "Start", "2026-09-14T10:00:00+00:00", "End", "not-a-date");
        FeatureFilterSummary.Lines(Feature(true, rule), []).Should().Equal("Start 2026-09-14 10:00, End not-a-date");
    }

    [Fact]
    public void Context_property_uses_operator_labels()
    {
        var eq = Rule(DashboardRuleInput.ContextProperty, "ContextKind", "Order", "Property", "Total", "Operator", "eq", "Value", "10", "ValueType", "number");
        FeatureFilterSummary.Lines(Feature(true, eq), []).Should().Equal("Order where Total is 10");

        var after = Rule(DashboardRuleInput.ContextProperty, "Property", "Created", "Operator", "gt", "Value", "2026-09-14T00:00:00Z", "ValueType", "datetime");
        FeatureFilterSummary.Lines(Feature(true, after), []).Should().Equal("Entity where Created is after 2026-09-14");
    }

    [Fact]
    public void User_claims_and_indexed_filters_render()
    {
        var claims = Rule(DashboardRuleInput.UserClaims, "Claim", "role", "Value", "admin", "Percentage", "50");
        FeatureFilterSummary.Lines(Feature(true, claims), []).Should().Equal("for role (Claim), for admin (Value), for 50% of users");

        var browsers = Rule(DashboardRuleInput.BrowserFamily, "BrowserFamily:0", "Chrome", "BrowserFamily:1", "Safari");
        FeatureFilterSummary.Lines(Feature(true, browsers), []).Should().Equal("for the following browsers: Chrome, Safari");

        var languages = Rule(DashboardRuleInput.BrowserLanguage, "BrowserLanguage:0", "en");
        FeatureFilterSummary.Lines(Feature(true, languages), []).Should().Equal("for the following languages: en");

        var os = Rule(DashboardRuleInput.OperatingSystem, "OperatingSystem:0", "iOS");
        FeatureFilterSummary.Lines(Feature(true, os), []).Should().Equal("for the following operating systems: iOS");

        var devices = Rule(DashboardRuleInput.DeviceType, "DeviceType:0", "mobile");
        FeatureFilterSummary.Lines(Feature(true, devices), []).Should().Equal("for the following devices: mobile");

        var countries = Rule(DashboardRuleInput.CountryFamily, "Country:0", "US");
        FeatureFilterSummary.Lines(Feature(true, countries), []).Should().Equal("for the following countries: US");
    }

    [Fact]
    public void Context_property_covers_remaining_operators()
    {
        FeatureFilterSummary.Lines(Feature(true, ContextRule("neq", "number", "1")), []).Should().Equal("Order where Total is not 1");
        FeatureFilterSummary.Lines(Feature(true, ContextRule("gte", "number", "1")), []).Should().Equal("Order where Total is greater than or equal to 1");
        FeatureFilterSummary.Lines(Feature(true, ContextRule("lt", "number", "1")), []).Should().Equal("Order where Total is less than 1");
        FeatureFilterSummary.Lines(Feature(true, ContextRule("lte", "number", "1")), []).Should().Equal("Order where Total is less than or equal to 1");
        FeatureFilterSummary.Lines(Feature(true, ContextRule("in", "string", "a,b")), []).Should().Equal("Order where Total is one of a,b");
        FeatureFilterSummary.Lines(Feature(true, ContextRule("contains", "string", "acme")), []).Should().Equal("Order where Total contains acme");
        FeatureFilterSummary.Lines(Feature(true, ContextRule("custom", "string", "x")), []).Should().Equal("Order where Total custom x");
        FeatureFilterSummary.Lines(Feature(true, ContextRule("gte", "datetime", "2026-09-14T00:00:00Z")), []).Should().Equal("Order where Total is on or after 2026-09-14");
        FeatureFilterSummary.Lines(Feature(true, ContextRule("lt", "datetime", "2026-09-14T00:00:00Z")), []).Should().Equal("Order where Total is before 2026-09-14");
        FeatureFilterSummary.Lines(Feature(true, ContextRule("lte", "datetime", "not-a-date")), []).Should().Equal("Order where Total is on or before not-a-date");
        FeatureFilterSummary.Lines(Feature(true, Rule(DashboardRuleInput.ContextProperty)), []).Should().BeEmpty();
    }

    [Fact]
    public void Indexed_and_list_summaries_skip_empty_values()
    {
        var unnamed = new CatalogList { Key = "ghost", Name = "", Description = "", Items = { "x" } };
        var targeting = Rule(DashboardRuleInput.Targeting, "Audience.Users", "ghost");
        FeatureFilterSummary.Lines(Feature(true, targeting), [unnamed]).Should().Equal("for ghost (Users)");
        FeatureFilterSummary.Lines(Feature(true, Rule(DashboardRuleInput.BrowserFamily, "BrowserFamily:0", "")), []).Should().BeEmpty();
        FeatureFilterSummary.Lines(Feature(true, Rule(DashboardRuleInput.FilterPercentage, "Value", "")), []).Should().BeEmpty();
    }

    [Fact]
    public void Unknown_filter_falls_back_to_the_rule_name()
    {
        FeatureFilterSummary.Lines(Feature(true, Rule("CustomFilter")), []).Should().Equal("CustomFilter");
    }

    private static CatalogRule ContextRule(string op, string valueType, string value) =>
        Rule(DashboardRuleInput.ContextProperty, "ContextKind", "Order", "Property", "Total", "Operator", op, "Value", value, "ValueType", valueType);

    private static CatalogFeature Feature(bool enabled, params CatalogRule[] rules) => new()
    {
        Key = "Checkout",
        Name = "Checkout",
        Enabled = enabled,
        Rules = [.. rules]
    };

    private static CatalogRule Rule(string name, params string[] pairs)
    {
        var parameters = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < pairs.Length; index += 2)
            parameters[pairs[index]] = pairs[index + 1];
        return new CatalogRule { Name = name, Parameters = parameters };
    }
}
