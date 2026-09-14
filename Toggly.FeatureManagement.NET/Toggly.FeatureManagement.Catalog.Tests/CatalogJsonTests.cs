using FluentAssertions;
using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Catalog.Tests;

public sealed class CatalogJsonTests
{
    [Fact]
    public void Parse_rejects_duplicate_json_property_names()
    {
        const string json = "{\"schemaVersion\":1,\"environment\":\"Production\",\"environment\":\"Staging\",\"features\":[],\"contexts\":[]}";

        var action = () => CatalogJson.Parse(json);

        action.Should().Throw<CatalogFormatException>()
            .Which.Message.Should().Contain("environment");
    }

    [Fact]
    public void Serialize_orders_catalog_content_canonically_and_round_trips_portable_fields()
    {
        var document = new CatalogDocument
        {
            SchemaVersion = 1,
            Environment = "Production",
            Features =
            [
                new CatalogFeature
                {
                    Key = "zeta",
                    Name = "Zeta",
                    Description = "Zeta feature",
                    Tags = ["z", "alpha"],
                    Enabled = true,
                    RequirementType = CatalogRequirementType.All,
                    Rules =
                    [
                        new CatalogRule
                        {
                            Name = "Percentage",
                            Parameters = new Dictionary<string, string>
                            {
                                ["Value"] = "25"
                            }
                        }
                    ]
                },
                new CatalogFeature
                {
                    Key = "alpha",
                    Name = "Alpha",
                    Description = "Alpha feature",
                    Tags = ["beta", "alpha"],
                    Enabled = false,
                    RequirementType = CatalogRequirementType.Any,
                    Rules = []
                }
            ],
            Contexts =
            [
                new CatalogContextSchema
                {
                    Kind = "Order",
                    KeyPropertyName = "Id",
                    Properties =
                    [
                        new CatalogContextProperty { Name = "Total", Type = "number" },
                        new CatalogContextProperty { Name = "Id", Type = "string" }
                    ]
                }
            ]
        };

        var json = CatalogJson.Serialize(document);
        var roundTripped = CatalogJson.Parse(json);

        json.Should().Be(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "testdata", "catalog-golden.json")).TrimEnd());
        roundTripped.Features.Select(feature => feature.Key).Should().Equal("alpha", "zeta");
        roundTripped.Features[0].Tags.Should().Equal("alpha", "beta");
        roundTripped.Contexts[0].Properties.Select(property => property.Name).Should().Equal("Id", "Total");
        roundTripped.Features[1].RequirementType.Should().Be(CatalogRequirementType.All);
        roundTripped.Features[0].Category.Should().Be(string.Empty);
        json.Should().NotContain("\"category\"");
    }

    [Fact]
    public void Parse_and_serialize_treat_missing_and_empty_category_as_uncategorized()
    {
        const string omitted = "{\"schemaVersion\":1,\"environment\":\"Production\",\"features\":[{\"key\":\"Checkout\",\"name\":\"Checkout\",\"description\":\"\",\"tags\":[],\"enabled\":false,\"requirementType\":\"Any\",\"contextKind\":null,\"contextRequirementType\":null,\"rules\":[]}],\"contexts\":[]}";
        const string empty = "{\"schemaVersion\":1,\"environment\":\"Production\",\"features\":[{\"key\":\"Checkout\",\"name\":\"Checkout\",\"description\":\"\",\"category\":\"\",\"tags\":[],\"enabled\":false,\"requirementType\":\"Any\",\"contextKind\":null,\"contextRequirementType\":null,\"rules\":[]}],\"contexts\":[]}";

        CatalogJson.Parse(omitted).Features[0].Category.Should().Be(string.Empty);
        CatalogJson.Parse(empty).Features[0].Category.Should().Be(string.Empty);

        var categorized = CatalogJson.Parse(omitted);
        categorized.Features[0].Category = "  Commerce  ";
        var serialized = CatalogJson.Serialize(categorized);
        serialized.Should().Contain("\"category\":\"Commerce\"");
        CatalogJson.Parse(serialized).Features[0].Category.Should().Be("Commerce");
    }

    [Fact]
    public void Parse_treats_omitted_lists_as_empty_and_round_trips_named_lists()
    {
        const string omitted = "{\"schemaVersion\":1,\"environment\":\"Production\",\"features\":[{\"key\":\"Checkout\",\"name\":\"Checkout\",\"description\":\"\",\"tags\":[],\"enabled\":false,\"requirementType\":\"Any\",\"contextKind\":null,\"contextRequirementType\":null,\"rules\":[]}],\"contexts\":[]}";

        CatalogJson.Parse(omitted).Lists.Should().BeEmpty();

        var document = CatalogJson.Parse(omitted);
        document.Lists =
        [
            new CatalogList
            {
                Key = "zeta",
                Name = "Zeta",
                Description = "",
                Items = ["bob"]
            },
            new CatalogList
            {
                Key = "beta",
                Name = "Beta",
                Description = "Testers",
                Items = ["alice"]
            }
        ];

        var serialized = CatalogJson.Serialize(document);
        serialized.Should().Contain("\"lists\":[{\"key\":\"beta\"");
        var roundTripped = CatalogJson.Parse(serialized);
        roundTripped.Lists.Select(list => list.Key).Should().Equal("beta", "zeta");
        roundTripped.Lists[0].Items.Should().Equal("alice");
        roundTripped.Lists[0].Name.Should().Be("Beta");
    }

    [Fact]
    public void Parse_rejects_unknown_portable_fields()
    {
        const string json = "{\"schemaVersion\":1,\"environment\":\"Production\",\"features\":[],\"contexts\":[],\"cloudApiKey\":\"not-allowed\"}";

        var action = () => CatalogJson.Parse(json);

        action.Should().Throw<CatalogFormatException>()
            .Which.Message.Should().Contain("cloudApiKey");
    }

    [Fact]
    public void Parse_and_serialize_preserve_the_canonical_fixture_for_every_supported_rule_format()
    {
        var fixture = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "testdata", "catalog-supported-rules.json")).TrimEnd();

        var document = CatalogJson.Parse(fixture);
        var serialized = CatalogJson.Serialize(document);

        document.Features.SelectMany(feature => feature.Rules).Select(rule => rule.Name).Should().Equal(
            "BrowserFamily", "DeviceType", "BrowserLanguage", "OS", "ContextProperty", "CountryFamily", "Percentage", "Targeting", "TimeWindow", "UserClaims");
        serialized.Should().Be(fixture);
    }
}
