using FluentAssertions;
using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Catalog.Tests;

public sealed class CatalogListExpansionTests
{
    [Fact]
    public void ExpandTargetingParameters_writes_indexed_ids_and_drops_list_keys()
    {
        var lists = new Dictionary<string, CatalogList>(StringComparer.OrdinalIgnoreCase)
        {
            ["beta"] = new CatalogList { Key = "beta", Items = ["alice", "bob"] }
        };
        var parameters = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Audience.Users"] = "beta",
            ["Audience.DefaultRolloutPercentage"] = "0",
            ["IgnoreCase"] = "true"
        };

        var expanded = CatalogListExpansion.ExpandTargetingParameters(parameters, lists);

        expanded.Should().Contain("Audience.Users:0", "alice");
        expanded.Should().Contain("Audience.Users:1", "bob");
        expanded.Should().NotContainKey("Audience.Users");
        expanded.Should().Contain("Audience.DefaultRolloutPercentage", "0");
        expanded.Should().Contain("IgnoreCase", "true");
    }

    [Fact]
    public void ExpandTargetingParameters_omits_indexed_keys_for_empty_lists()
    {
        var lists = new Dictionary<string, CatalogList>(StringComparer.OrdinalIgnoreCase)
        {
            ["empty"] = new CatalogList { Key = "empty", Items = [] }
        };
        var parameters = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Audience.Users"] = "empty",
            ["Audience.DefaultRolloutPercentage"] = "0"
        };

        var expanded = CatalogListExpansion.ExpandTargetingParameters(parameters, lists);

        expanded.Keys.Should().NotContain(key => key.StartsWith("Audience.Users:", StringComparison.Ordinal));
        expanded.Should().NotContainKey("Audience.Users");
        expanded.Should().Contain("Audience.DefaultRolloutPercentage", "0");
    }

    [Fact]
    public void ExpandTargetingParameters_expands_groups_and_exclusions()
    {
        var lists = new Dictionary<string, CatalogList>(StringComparer.OrdinalIgnoreCase)
        {
            ["staff"] = new CatalogList { Key = "staff", Items = ["ops"] },
            ["blocked"] = new CatalogList { Key = "blocked", Items = ["eve"] }
        };
        var parameters = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Audience.Groups"] = "staff",
            ["Audience.Exclusion.Users"] = "blocked",
            ["Audience.DefaultRolloutPercentage"] = "100"
        };

        var expanded = CatalogListExpansion.ExpandTargetingParameters(parameters, lists);

        expanded.Should().Contain("Audience.Groups:0", "ops");
        expanded.Should().Contain("Audience.Exclusion.Users:0", "eve");
        expanded.Should().NotContainKey("Audience.Groups");
        expanded.Should().NotContainKey("Audience.Exclusion.Users");
    }
}
