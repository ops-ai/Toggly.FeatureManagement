using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.FeatureManagement;
using Moq;
using Toggly.FeatureManagement.Context;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class ContextPropertyFilterTests
{
    [Fact]
    public async Task EvaluateAsync_WithoutEntity_FailsClosedBeforeLookingUpDefinition()
    {
        var definitions = new Mock<IFeatureDefinitionModelProvider>(MockBehavior.Strict);
        var filter = CreateFilter(definitions.Object);

        var result = await filter.EvaluateAsync(CreateContext(), new TogglyEvaluationContext());

        result.Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_WhenDefinitionIsMissing_FailsClosed()
    {
        var definitions = new Mock<IFeatureDefinitionModelProvider>();
        definitions
            .Setup(provider => provider.TryGetFeatureModel("OrderBadge", out It.Ref<FeatureDefinitionModel?>.IsAny))
            .Returns(false);
        var filter = CreateFilter(definitions.Object);

        var result = await filter.EvaluateAsync(CreateContext(), CreateOrderContext("red"));

        result.Should().BeFalse();
    }

    [Theory]
    [InlineData("red", true)]
    [InlineData("blue", false)]
    public async Task EvaluateAsync_EvaluatesTheResolvedContextProperty(string color, bool expected)
    {
        var definitions = new Mock<IFeatureDefinitionModelProvider>();
        definitions
            .Setup(provider => provider.TryGetFeatureModel("OrderBadge", out It.Ref<FeatureDefinitionModel?>.IsAny))
            .Returns((string _, out FeatureDefinitionModel? model) =>
            {
                model = new FeatureDefinitionModel
                {
                    FeatureKey = "OrderBadge",
                    Filters =
                    [
                        new FeatureFilter
                        {
                            Name = "ContextProperty",
                            Parameters = new Dictionary<string, string>
                            {
                                ["Property"] = "Color",
                                ["Operator"] = "eq",
                                ["Value"] = "red",
                                ["ValueType"] = "string"
                            }
                        }
                    ]
                };
                return true;
            });
        var filter = CreateFilter(definitions.Object);

        var result = await filter.EvaluateAsync(CreateContext(), CreateOrderContext(color));

        result.Should().Be(expected);
    }

    private static ContextPropertyFilter CreateFilter(IFeatureDefinitionModelProvider definitions) =>
        new(definitions, Mock.Of<ILogger<ContextPropertyFilter>>());

    private static FeatureFilterEvaluationContext CreateContext() =>
        new() { FeatureName = "OrderBadge" };

    private static TogglyEvaluationContext CreateOrderContext(string color) =>
        new(new TogglyEntityContext(
            "Order",
            "42",
            new Dictionary<string, object?> { ["Color"] = color }));
}
