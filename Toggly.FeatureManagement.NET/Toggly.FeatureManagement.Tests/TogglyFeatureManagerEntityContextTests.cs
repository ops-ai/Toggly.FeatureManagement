using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using Moq;
using System.Collections.Generic;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class TogglyFeatureManagerEntityContextTests
{
    [Fact]
    public async Task IsEnabledAsync_WithoutContext_FailsClosedWhenEntityFiltersExist()
    {
        var inner = new Mock<IFeatureManager>();
        inner.Setup(m => m.IsEnabledAsync("OrderBadge")).ReturnsAsync(true);

        var definitions = new Mock<IFeatureDefinitionModelProvider>();
        definitions.Setup(m => m.TryGetFeatureModel("OrderBadge", out It.Ref<FeatureDefinitionModel?>.IsAny))
            .Returns((string _, out FeatureDefinitionModel? model) =>
            {
                model = new FeatureDefinitionModel
                {
                    FeatureKey = "OrderBadge",
                    Filters = new List<FeatureFilter>
                    {
                        new() { Name = "AlwaysOn" },
                        new()
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
                    }
                };
                return true;
            });

        var manager = CreateManager(inner.Object, definitions.Object);
        var result = await manager.IsEnabledAsync("OrderBadge");
        result.Should().BeFalse();
    }

    [Fact]
    public async Task IsEnabledAsync_WithContext_EvaluatesEntityRules()
    {
        var inner = new Mock<IFeatureManager>();
        inner.Setup(m => m.IsEnabledAsync("OrderBadge")).ReturnsAsync(true);

        var definitions = new Mock<IFeatureDefinitionModelProvider>();
        definitions.Setup(m => m.TryGetFeatureModel("OrderBadge", out It.Ref<FeatureDefinitionModel?>.IsAny))
            .Returns((string _, out FeatureDefinitionModel? model) =>
            {
                model = new FeatureDefinitionModel
                {
                    FeatureKey = "OrderBadge",
                    Filters = new List<FeatureFilter>
                    {
                        new() { Name = "AlwaysOn" },
                        new()
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
                    }
                };
                return true;
            });

        var entityResolver = new Mock<ITogglyEntityContextResolver>();
        entityResolver
            .Setup(r => r.TryResolve(It.IsAny<object>(), out It.Ref<Toggly.FeatureManagement.Context.TogglyEntityContext?>.IsAny))
            .Returns((object _, out Toggly.FeatureManagement.Context.TogglyEntityContext? context) =>
            {
                context = new Toggly.FeatureManagement.Context.TogglyEntityContext(
                    "Order",
                    "1",
                    new Dictionary<string, object?> { ["Color"] = "red" });
                return true;
            });

        var manager = CreateManager(inner.Object, definitions.Object, entityResolver.Object);
        var result = await manager.IsEnabledAsync("OrderBadge", new { Id = 1, Color = "red" });
        result.Should().BeTrue();
    }

    [Fact]
    public async Task IsEnabledAsync_EntityOnlyDefinition_DoesNotRequireUserFilters()
    {
        var inner = new Mock<IFeatureManager>();
        inner.Setup(m => m.IsEnabledAsync("OrderBadge")).ReturnsAsync(false);

        var definitions = new Mock<IFeatureDefinitionModelProvider>();
        definitions.Setup(m => m.TryGetFeatureModel("OrderBadge", out It.Ref<FeatureDefinitionModel?>.IsAny))
            .Returns((string _, out FeatureDefinitionModel? model) =>
            {
                model = new FeatureDefinitionModel
                {
                    FeatureKey = "OrderBadge",
                    Filters = new List<FeatureFilter>
                    {
                        new()
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
                    }
                };
                return true;
            });

        var entityResolver = new Mock<ITogglyEntityContextResolver>();
        entityResolver
            .Setup(r => r.TryResolve(It.IsAny<object>(), out It.Ref<Toggly.FeatureManagement.Context.TogglyEntityContext?>.IsAny))
            .Returns((object _, out Toggly.FeatureManagement.Context.TogglyEntityContext? context) =>
            {
                context = new Toggly.FeatureManagement.Context.TogglyEntityContext(
                    "Order",
                    "1",
                    new Dictionary<string, object?> { ["Color"] = "red" });
                return true;
            });

        var manager = CreateManager(inner.Object, definitions.Object, entityResolver.Object);
        var result = await manager.IsEnabledAsync("OrderBadge", new { Id = 1, Color = "red" });
        result.Should().BeTrue();
        inner.Verify(m => m.IsEnabledAsync("OrderBadge"), Times.Never);
    }

    private static TogglyFeatureManager CreateManager(
        IFeatureManager inner,
        IFeatureDefinitionModelProvider definitions,
        ITogglyEntityContextResolver? entityResolver = null)
    {
        var services = new ServiceCollection();
        services.AddSingleton(definitions);
        if (entityResolver != null)
            services.AddSingleton(entityResolver);

        var usage = new Mock<IFeatureUsageStatsProvider>();
        var secure = new Mock<ISecureFeatureProvider>();
        secure.Setup(s => s.IsFeatureSecured(It.IsAny<string>())).Returns(false);

        return new TogglyFeatureManager(
            inner,
            usage.Object,
            secure.Object,
            services.BuildServiceProvider());
    }
}
