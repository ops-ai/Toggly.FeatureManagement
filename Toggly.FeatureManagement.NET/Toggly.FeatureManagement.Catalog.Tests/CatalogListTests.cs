using FluentAssertions;
using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Catalog.Tests;

public sealed class CatalogListTests
{
    [Fact]
    public void NormalizeAndValidate_treats_omitted_lists_as_empty()
    {
        var document = EnabledWithAlwaysOn();
        document.Lists = null!;

        var result = CatalogValidator.NormalizeAndValidate(document);

        result.IsValid.Should().BeTrue();
        result.Document!.Lists.Should().BeEmpty();
    }

    [Fact]
    public void NormalizeAndValidate_round_trips_list_fields_and_drops_empty_items()
    {
        var document = EnabledWithAlwaysOn();
        document.Lists =
        [
            new CatalogList
            {
                Key = " beta-testers ",
                Name = " Beta testers ",
                Description = " Internal ",
                Items = [" alice ", "", "bob", "  "]
            }
        ];

        var result = CatalogValidator.NormalizeAndValidate(document);

        result.IsValid.Should().BeTrue();
        var list = result.Document!.Lists.Should().ContainSingle().Subject;
        list.Key.Should().Be("beta-testers");
        list.Name.Should().Be("Beta testers");
        list.Description.Should().Be("Internal");
        list.Items.Should().Equal("alice", "bob");
    }

    [Fact]
    public void Validate_rejects_duplicate_list_keys()
    {
        var document = EnabledWithAlwaysOn();
        document.Lists =
        [
            new CatalogList { Key = "beta", Name = "Beta", Description = string.Empty, Items = [] },
            new CatalogList { Key = "BETA", Name = "Other", Description = string.Empty, Items = [] }
        ];

        var result = CatalogValidator.Validate(document);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(error => error.Path == "lists[1].key");
    }

    [Theory]
    [InlineData("-invalid")]
    [InlineData("contains spaces")]
    [InlineData("1StartsWithNumber")]
    public void Validate_rejects_invalid_list_keys(string key)
    {
        var document = EnabledWithAlwaysOn();
        document.Lists = [new CatalogList { Key = key, Name = "Beta", Description = string.Empty, Items = [] }];

        var result = CatalogValidator.Validate(document);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(error => error.Path == "lists[0].key");
    }

    [Fact]
    public void Validate_rejects_duplicate_list_items()
    {
        var document = EnabledWithAlwaysOn();
        document.Lists =
        [
            new CatalogList { Key = "beta", Name = "Beta", Description = string.Empty, Items = ["alice", "alice"] }
        ];

        var result = CatalogValidator.Validate(document);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(error => error.Path == "lists[0].items[1]");
    }

    [Fact]
    public void Validate_accepts_targeting_list_keys_and_rejects_unknown_keys_and_indexed_ids()
    {
        var document = EnabledWithAlwaysOn();
        document.Lists = [new CatalogList { Key = "beta", Name = "Beta", Description = string.Empty, Items = ["alice"] }];
        document.Features[0].Rules =
        [
            new CatalogRule
            {
                Name = "Targeting",
                Parameters = new Dictionary<string, string>
                {
                    ["Audience.Users"] = "beta",
                    ["Audience.DefaultRolloutPercentage"] = "0",
                    ["IgnoreCase"] = "true"
                }
            }
        ];

        CatalogValidator.Validate(document).IsValid.Should().BeTrue();

        document.Features[0].Rules[0].Parameters["Audience.Users"] = "missing";
        var missing = CatalogValidator.Validate(document);
        missing.IsValid.Should().BeFalse();
        missing.Errors.Should().Contain(error => error.Path == "features[0].rules[0].parameters.Audience.Users");

        document.Features[0].Rules[0].Parameters.Remove("Audience.Users");
        document.Features[0].Rules[0].Parameters["Audience.Users:0"] = "alice";
        var indexed = CatalogValidator.Validate(document);
        indexed.IsValid.Should().BeFalse();
        indexed.Errors.Should().Contain(error => error.Path == "features[0].rules[0].parameters.Audience.Users:0");
    }

    [Fact]
    public void Validate_rejects_enabled_feature_with_no_rules()
    {
        var document = EnabledWithAlwaysOn();
        document.Features[0].Rules = [];

        var result = CatalogValidator.Validate(document);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(error => error.Path == "features[0].rules");
    }

    [Fact]
    public void Validate_accepts_disabled_feature_with_no_rules()
    {
        var document = EnabledWithAlwaysOn();
        document.Features[0].Enabled = false;
        document.Features[0].Rules = [];

        CatalogValidator.Validate(document).IsValid.Should().BeTrue();
    }

    private static CatalogDocument EnabledWithAlwaysOn() => new()
    {
        SchemaVersion = 1,
        Environment = "Production",
        Features =
        [
            new CatalogFeature
            {
                Key = "Checkout",
                Name = "Checkout",
                Description = string.Empty,
                Tags = [],
                Enabled = true,
                RequirementType = CatalogRequirementType.Any,
                Rules = [new CatalogRule { Name = "AlwaysOn", Parameters = new Dictionary<string, string>(StringComparer.Ordinal) }]
            }
        ],
        Contexts = []
    };
}
