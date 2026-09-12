using FluentAssertions;
using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Catalog.Tests;

public sealed class CatalogValidatorTests
{
    [Fact]
    public void Validate_reports_case_insensitive_duplicate_feature_keys()
    {
        var document = ValidDocument();
        document.Features.Add(new CatalogFeature
        {
            Key = "checkout",
            Name = "Duplicate",
            Description = string.Empty,
            Tags = [],
            Enabled = false,
            RequirementType = CatalogRequirementType.Any,
            Rules = []
        });

        var result = CatalogValidator.Validate(document);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(error => error.Path == "features[1].key");
    }

    [Theory]
    [InlineData("-invalid")]
    [InlineData("contains spaces")]
    [InlineData("1StartsWithNumber")]
    public void Validate_rejects_invalid_feature_keys(string key)
    {
        var document = ValidDocument();
        document.Features[0].Key = key;

        var result = CatalogValidator.Validate(document);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(error => error.Path == "features[0].key");
    }

    [Fact]
    public void Validate_rejects_unknown_filter_and_invalid_percentage_without_clamping()
    {
        var document = ValidDocument();
        document.Features[0].Rules =
        [
            new CatalogRule { Name = "Unknown", Parameters = new Dictionary<string, string>() },
            new CatalogRule { Name = "Percentage", Parameters = new Dictionary<string, string> { ["Value"] = "101" } }
        ];

        var result = CatalogValidator.Validate(document);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(error => error.Path == "features[0].rules[0].name");
        result.Errors.Should().Contain(error => error.Path == "features[0].rules[1].parameters.Value");
    }

    [Fact]
    public void NormalizeAndValidate_trims_keys_names_and_tags_and_deduplicates_tags()
    {
        var document = ValidDocument();
        document.Features[0].Key = " Checkout ";
        document.Features[0].Name = " Checkout ";
        document.Features[0].Tags = [" beta ", "BETA", "", "alpha"];

        var result = CatalogValidator.NormalizeAndValidate(document);

        result.IsValid.Should().BeTrue();
        result.Document!.Features[0].Key.Should().Be("Checkout");
        result.Document.Features[0].Name.Should().Be("Checkout");
        result.Document.Features[0].Tags.Should().Equal("alpha", "beta");
    }

    [Fact]
    public void Validate_aligns_context_schema_shape_with_application_context_rules()
    {
        var document = ValidDocument();
        document.Contexts =
        [
            new CatalogContextSchema
            {
                Kind = "User",
                KeyPropertyName = "Missing",
                Properties = []
            },
            new CatalogContextSchema
            {
                Kind = "Order-Context",
                KeyPropertyName = "Id",
                Properties = [new CatalogContextProperty { Name = "Id", Type = "string" }]
            }
        ];

        var result = CatalogValidator.Validate(document);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(error => error.Path == "contexts[0].kind");
        result.Errors.Should().Contain(error => error.Path == "contexts[0].properties");
        result.Errors.Should().Contain(error => error.Path == "contexts[0].keyPropertyName");
        result.Errors.Should().Contain(error => error.Path == "contexts[1].kind");
    }

    [Fact]
    public void NormalizeAndValidate_stamps_context_property_rules_using_case_insensitive_schema_lookups_and_in_values()
    {
        var document = ValidDocument();
        document.Contexts =
        [
            new CatalogContextSchema
            {
                Kind = "Order",
                KeyPropertyName = "Id",
                Properties =
                [
                    new CatalogContextProperty { Name = "Id", Type = "string" },
                    new CatalogContextProperty { Name = "Tier", Type = "STRING" }
                ]
            }
        ];
        document.Features[0].ContextKind = "order";
        document.Features[0].Rules =
        [
            new CatalogRule
            {
                Name = "ContextProperty",
                Parameters = new Dictionary<string, string>
                {
                    ["ContextKind"] = "ORDER",
                    ["Property"] = "tier",
                    ["Operator"] = "IN",
                    ["Value"] = "free, pro",
                    ["ValueType"] = "incorrect"
                }
            }
        ];

        var result = CatalogValidator.NormalizeAndValidate(document);

        result.IsValid.Should().BeTrue();
        result.Document!.Contexts[0].Properties[1].Type.Should().Be("string");
        result.Document.Features[0].Rules[0].Parameters.Should().Contain(new KeyValuePair<string, string>("ContextKind", "Order"));
        result.Document.Features[0].Rules[0].Parameters.Should().Contain(new KeyValuePair<string, string>("Property", "Tier"));
        result.Document.Features[0].Rules[0].Parameters.Should().Contain(new KeyValuePair<string, string>("ValueType", "string"));
    }

    private static CatalogDocument ValidDocument() => new()
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
                Rules = []
            }
        ],
        Contexts = []
    };
}
