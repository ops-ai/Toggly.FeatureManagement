using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Moq;
using Toggly.FeatureManagement.Data;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class FeatureValueManagerExtensionsTests
{
    private const string Feature = "pricing-banner";
    private const string VariantName = "value";

    [Fact]
    public async Task GetStringValueAsync_UsesCatalogConfigurationValue_WhenDefinitionsProviderResolves()
    {
        var manager = CreateManager(CreateVariant(VariantName, new Dictionary<string, string?> { ["v"] = "hello" }));
        var definitions = CreateDefinitionsProvider(FeatureValueType.String, VariantName, "\"hello\"");

        var value = await manager.GetStringValueAsync(Feature, definitions);

        value.Should().Be("hello");
    }

    [Fact]
    public async Task GetStringValueAsync_SoftDecodesFromConfiguration_WhenNoDefinitionsProvider()
    {
        var manager = CreateManager(CreateVariant(VariantName, new Dictionary<string, string?> { ["v"] = "hello" }));

        var value = await manager.GetStringValueAsync(Feature);

        value.Should().Be("hello");
    }

    [Fact]
    public async Task GetStringValueAsync_ReturnsNull_WhenNoVariantAssigned()
    {
        var manager = CreateManager(variant: null);

        var value = await manager.GetStringValueAsync(Feature);

        value.Should().BeNull();
    }

    [Fact]
    public async Task GetStringValueAsync_ReturnsNull_WhenCatalogDeclaresMismatchedType()
    {
        var manager = CreateManager(CreateVariant(VariantName, new Dictionary<string, string?> { ["v"] = "hello" }));
        var definitions = CreateDefinitionsProvider(FeatureValueType.Number, VariantName, "\"hello\"");

        var value = await manager.GetStringValueAsync(Feature, definitions);

        value.Should().BeNull();
    }

    [Fact]
    public async Task GetNumberValueAsync_UsesCatalogConfigurationValue()
    {
        var manager = CreateManager(CreateVariant(VariantName, new Dictionary<string, string?> { ["v"] = "42" }));
        var definitions = CreateDefinitionsProvider(FeatureValueType.Number, VariantName, "42.5");

        var value = await manager.GetNumberValueAsync(Feature, definitions);

        value.Should().Be(42.5);
    }

    [Fact]
    public async Task GetNumberValueAsync_SoftDecodesScalarConfiguration_WhenNoDefinitionsProvider()
    {
        var manager = CreateManager(CreateVariant(VariantName, new Dictionary<string, string?> { ["v"] = "42" }));

        var value = await manager.GetNumberValueAsync(Feature);

        value.Should().Be(42);
    }

    [Fact]
    public async Task GetNumberValueAsync_ReturnsNull_WhenValueIsNotNumeric()
    {
        var manager = CreateManager(CreateVariant(VariantName, new Dictionary<string, string?> { ["v"] = "not-a-number" }));

        var value = await manager.GetNumberValueAsync(Feature);

        value.Should().BeNull();
    }

    [Fact]
    public async Task GetJsonValueAsync_ReturnsClonedCatalogElement_ForObject()
    {
        var manager = CreateManager(CreateVariant(VariantName, new Dictionary<string, string?>
        {
            ["v:theme"] = "dark",
            ["v:fontSize"] = "14"
        }));
        var definitions = CreateDefinitionsProvider(FeatureValueType.Json, VariantName, "{\"theme\":\"dark\",\"fontSize\":14}");

        var value = await manager.GetJsonValueAsync(Feature, definitions);

        value.Should().NotBeNull();
        value!.Value.ValueKind.Should().Be(JsonValueKind.Object);
        value.Value.GetProperty("theme").GetString().Should().Be("dark");
        value.Value.GetProperty("fontSize").GetInt32().Should().Be(14);
    }

    [Fact]
    public async Task GetJsonValueAsync_ReconstructsObjectFromConfiguration_WhenNoDefinitionsProvider()
    {
        var manager = CreateManager(CreateVariant(VariantName, new Dictionary<string, string?>
        {
            ["v:theme"] = "dark",
            ["v:fontSize"] = "14"
        }));

        var value = await manager.GetJsonValueAsync(Feature);

        value.Should().NotBeNull();
        value!.Value.ValueKind.Should().Be(JsonValueKind.Object);
        value.Value.GetProperty("theme").GetString().Should().Be("dark");
        value.Value.GetProperty("fontSize").GetInt32().Should().Be(14);
    }

    [Fact]
    public async Task GetJsonValueAsync_ReturnsNull_ForScalarConfiguration()
    {
        var manager = CreateManager(CreateVariant(VariantName, new Dictionary<string, string?> { ["v"] = "hello" }));

        var value = await manager.GetJsonValueAsync(Feature);

        value.Should().BeNull();
    }

    [Fact]
    public async Task GetDateTimeValueAsync_UsesCatalogConfigurationValue()
    {
        var manager = CreateManager(CreateVariant(VariantName, new Dictionary<string, string?> { ["v"] = "2026-01-01T00:00:00Z" }));
        var definitions = CreateDefinitionsProvider(FeatureValueType.DateTime, VariantName, "\"2026-02-03T04:05:06Z\"");

        var value = await manager.GetDateTimeValueAsync(Feature, definitions);

        value.Should().Be(System.DateTimeOffset.Parse("2026-02-03T04:05:06Z"));
    }

    [Fact]
    public async Task GetDateTimeValueAsync_SoftDecodesFromConfiguration_WhenNoDefinitionsProvider()
    {
        var manager = CreateManager(CreateVariant(VariantName, new Dictionary<string, string?> { ["v"] = "2026-01-01T00:00:00Z" }));

        var value = await manager.GetDateTimeValueAsync(Feature);

        value.Should().Be(System.DateTimeOffset.Parse("2026-01-01T00:00:00Z"));
    }

    [Fact]
    public async Task GetDateTimeValueAsync_ReturnsNull_WhenUnparsable()
    {
        var manager = CreateManager(CreateVariant(VariantName, new Dictionary<string, string?> { ["v"] = "not-a-date" }));

        var value = await manager.GetDateTimeValueAsync(Feature);

        value.Should().BeNull();
    }

    [Fact]
    public async Task GetStringValueAsync_WithTargetingContext_UsesContextOverload()
    {
        var context = new TargetingContext { UserId = "alice" };
        var managerMock = new Mock<IVariantFeatureManager>();
        managerMock
            .Setup(m => m.GetVariantAsync(
                Feature,
                It.Is<ITargetingContext>(c => c.UserId == "alice"),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(CreateVariant(VariantName, new Dictionary<string, string?> { ["v"] = "hello" }));

        var value = await managerMock.Object.GetStringValueAsync(Feature, context);

        value.Should().Be("hello");
        managerMock.Verify(
            m => m.GetVariantAsync(
                Feature,
                It.Is<ITargetingContext>(c => c.UserId == "alice"),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    private static IVariantFeatureManager CreateManager(Variant? variant)
    {
        var managerMock = new Mock<IVariantFeatureManager>();
        managerMock
            .Setup(m => m.GetVariantAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(variant);
        return managerMock.Object;
    }

    private static Variant CreateVariant(string name, Dictionary<string, string?> data)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(data)
            .Build();

        return new Variant
        {
            Name = name,
            Configuration = configuration.GetSection("v")
        };
    }

    private static IFeatureDefinitionModelProvider CreateDefinitionsProvider(FeatureValueType valueType, string variantName, string configurationValueJson)
    {
        using var document = JsonDocument.Parse(configurationValueJson);
        var model = new FeatureDefinitionModel
        {
            FeatureKey = Feature,
            ValueType = valueType,
            Variants = new List<Toggly.FeatureManagement.Data.VariantDefinition>
            {
                new Toggly.FeatureManagement.Data.VariantDefinition { Name = variantName, ConfigurationValue = document.RootElement.Clone() }
            }
        };

        var providerMock = new Mock<IFeatureDefinitionModelProvider>();
        FeatureDefinitionModel? outModel = model;
        providerMock
            .Setup(p => p.TryGetFeatureModel(Feature, out outModel))
            .Returns(true);
        return providerMock.Object;
    }
}
