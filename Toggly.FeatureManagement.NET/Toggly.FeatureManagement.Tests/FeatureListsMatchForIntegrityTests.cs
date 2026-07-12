using FluentAssertions;
using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Data;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

/// <summary>
/// Unit tests for snapshot Features vs verified SignedDefsJson fingerprint matching.
/// </summary>
public class FeatureListsMatchForIntegrityTests
{
    private static FeatureDefinitionModel Flag(
        string key,
        bool secured = false,
        RequirementType requirement = RequirementType.Any,
        List<FeatureFilter>? filters = null,
        List<string>? metrics = null) =>
        new()
        {
            FeatureKey = key,
            SecuredFeature = secured,
            RequirementType = requirement,
            Filters = filters ?? new List<FeatureFilter> { new() { Name = "AlwaysOn", Parameters = new Dictionary<string, string>() } },
            Metrics = metrics
        };

    [Fact]
    public void Match_IdenticalLists_ReturnsTrue()
    {
        var a = new List<FeatureDefinitionModel> { Flag("a"), Flag("b", secured: true, metrics: new List<string> { "m1" }) };
        var b = new List<FeatureDefinitionModel> { Flag("a"), Flag("b", secured: true, metrics: new List<string> { "m1" }) };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(a, b).Should().BeTrue();
    }

    [Fact]
    public void Match_DifferentOrder_ReturnsTrue()
    {
        var stored = new List<FeatureDefinitionModel> { Flag("b"), Flag("a") };
        var verified = new List<FeatureDefinitionModel> { Flag("a"), Flag("b") };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeTrue();
    }

    [Fact]
    public void Match_FilterParameterOrderDoesNotMatter_ReturnsTrue()
    {
        var stored = new List<FeatureDefinitionModel>
        {
            Flag("pct", filters: new List<FeatureFilter>
            {
                new()
                {
                    Name = "Percentage",
                    Parameters = new Dictionary<string, string> { ["B"] = "2", ["A"] = "1" }
                }
            })
        };
        var verified = new List<FeatureDefinitionModel>
        {
            Flag("pct", filters: new List<FeatureFilter>
            {
                new()
                {
                    Name = "Percentage",
                    Parameters = new Dictionary<string, string> { ["A"] = "1", ["B"] = "2" }
                }
            })
        };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeTrue();
    }

    [Fact]
    public void Match_MetricsOrderDoesNotMatter_ReturnsTrue()
    {
        var stored = new List<FeatureDefinitionModel> { Flag("a", metrics: new List<string> { "z", "a" }) };
        var verified = new List<FeatureDefinitionModel> { Flag("a", metrics: new List<string> { "a", "z" }) };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeTrue();
    }

    [Fact]
    public void Match_NullMetricsAndEmptyMetrics_AreEquivalent()
    {
        var stored = new List<FeatureDefinitionModel> { Flag("a", metrics: null) };
        var verified = new List<FeatureDefinitionModel> { Flag("a", metrics: new List<string>()) };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeTrue();
    }

    [Fact]
    public void Match_NullFiltersAndEmptyFilters_AreEquivalent()
    {
        var stored = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "a", Filters = null! }
        };
        var verified = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "a", Filters = new List<FeatureFilter>() }
        };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeTrue();
    }

    [Fact]
    public void Match_BothEmpty_ReturnsTrue()
    {
        TogglyFeatureProvider.FeatureListsMatchForIntegrity(
            new List<FeatureDefinitionModel>(),
            new List<FeatureDefinitionModel>()).Should().BeTrue();
    }

    [Fact]
    public void Mismatch_DifferentFeatureKey_ReturnsFalse()
    {
        var stored = new List<FeatureDefinitionModel> { Flag("evil") };
        var verified = new List<FeatureDefinitionModel> { Flag("good") };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeFalse();
    }

    [Fact]
    public void Mismatch_ExtraFeatureInStored_ReturnsFalse()
    {
        var stored = new List<FeatureDefinitionModel> { Flag("a"), Flag("evil") };
        var verified = new List<FeatureDefinitionModel> { Flag("a") };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeFalse();
    }

    [Fact]
    public void Mismatch_MissingFeatureInStored_ReturnsFalse()
    {
        var stored = new List<FeatureDefinitionModel> { Flag("a") };
        var verified = new List<FeatureDefinitionModel> { Flag("a"), Flag("b") };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeFalse();
    }

    [Fact]
    public void Mismatch_SecuredFeatureFlipped_ReturnsFalse()
    {
        var stored = new List<FeatureDefinitionModel> { Flag("a", secured: true) };
        var verified = new List<FeatureDefinitionModel> { Flag("a", secured: false) };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeFalse();
    }

    [Fact]
    public void Mismatch_RequirementTypeChanged_ReturnsFalse()
    {
        var stored = new List<FeatureDefinitionModel> { Flag("a", requirement: RequirementType.All) };
        var verified = new List<FeatureDefinitionModel> { Flag("a", requirement: RequirementType.Any) };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeFalse();
    }

    [Fact]
    public void Mismatch_FilterNameChanged_ReturnsFalse()
    {
        var stored = new List<FeatureDefinitionModel>
        {
            Flag("a", filters: new List<FeatureFilter> { new() { Name = "AlwaysOff" } })
        };
        var verified = new List<FeatureDefinitionModel>
        {
            Flag("a", filters: new List<FeatureFilter> { new() { Name = "AlwaysOn" } })
        };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeFalse();
    }

    [Fact]
    public void Mismatch_FilterParameterValueChanged_ReturnsFalse()
    {
        var stored = new List<FeatureDefinitionModel>
        {
            Flag("pct", filters: new List<FeatureFilter>
            {
                new()
                {
                    Name = "Percentage",
                    Parameters = new Dictionary<string, string> { ["Value"] = "99" }
                }
            })
        };
        var verified = new List<FeatureDefinitionModel>
        {
            Flag("pct", filters: new List<FeatureFilter>
            {
                new()
                {
                    Name = "Percentage",
                    Parameters = new Dictionary<string, string> { ["Value"] = "10" }
                }
            })
        };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeFalse();
    }

    [Fact]
    public void Mismatch_FilterParameterAdded_ReturnsFalse()
    {
        var stored = new List<FeatureDefinitionModel>
        {
            Flag("pct", filters: new List<FeatureFilter>
            {
                new()
                {
                    Name = "Percentage",
                    Parameters = new Dictionary<string, string> { ["Value"] = "10", ["Extra"] = "x" }
                }
            })
        };
        var verified = new List<FeatureDefinitionModel>
        {
            Flag("pct", filters: new List<FeatureFilter>
            {
                new()
                {
                    Name = "Percentage",
                    Parameters = new Dictionary<string, string> { ["Value"] = "10" }
                }
            })
        };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeFalse();
    }

    [Fact]
    public void Mismatch_ExtraFilter_ReturnsFalse()
    {
        var stored = new List<FeatureDefinitionModel>
        {
            Flag("a", filters: new List<FeatureFilter>
            {
                new() { Name = "AlwaysOn" },
                new() { Name = "Percentage", Parameters = new Dictionary<string, string> { ["Value"] = "1" } }
            })
        };
        var verified = new List<FeatureDefinitionModel>
        {
            Flag("a", filters: new List<FeatureFilter> { new() { Name = "AlwaysOn" } })
        };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeFalse();
    }

    [Fact]
    public void Mismatch_MetricsChanged_ReturnsFalse()
    {
        var stored = new List<FeatureDefinitionModel> { Flag("a", metrics: new List<string> { "impressions" }) };
        var verified = new List<FeatureDefinitionModel> { Flag("a", metrics: new List<string> { "clicks" }) };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeFalse();
    }

    [Fact]
    public void Mismatch_MetricsAdded_ReturnsFalse()
    {
        var stored = new List<FeatureDefinitionModel> { Flag("a", metrics: new List<string> { "m1", "m2" }) };
        var verified = new List<FeatureDefinitionModel> { Flag("a", metrics: new List<string> { "m1" }) };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeFalse();
    }

    [Fact]
    public void Mismatch_SameKeyDifferentFilterAndMetrics_ReturnsFalse()
    {
        // Compound tamper: keep key, change both filter and metrics.
        var stored = new List<FeatureDefinitionModel>
        {
            Flag("a",
                secured: true,
                requirement: RequirementType.All,
                filters: new List<FeatureFilter>
                {
                    new() { Name = "Percentage", Parameters = new Dictionary<string, string> { ["Value"] = "100" } }
                },
                metrics: new List<string> { "evil-metric" })
        };
        var verified = new List<FeatureDefinitionModel> { Flag("a") };

        TogglyFeatureProvider.FeatureListsMatchForIntegrity(stored, verified).Should().BeFalse();
    }
}
