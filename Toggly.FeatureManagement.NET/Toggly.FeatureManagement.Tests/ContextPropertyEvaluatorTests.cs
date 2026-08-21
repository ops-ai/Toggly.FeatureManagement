using FluentAssertions;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Generic;
using Toggly.FeatureManagement.Context;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class ContextPropertyEvaluatorTests
{
    [Fact]
    public void EvaluateEntityFilters_DateTimeGreaterThan_Matches()
    {
        var definition = CreateDefinition(
            RequirementType.All,
            new FeatureFilter
            {
                Name = "ContextProperty",
                Parameters = new Dictionary<string, string>
                {
                    ["Property"] = "OrderDate",
                    ["Operator"] = "gt",
                    ["Value"] = "2026-06-10T00:00:00Z",
                    ["ValueType"] = "datetime"
                }
            });

        var entity = new TogglyEntityContext(
            "Order",
            "42",
            new Dictionary<string, object?> { ["OrderDate"] = new DateTimeOffset(2026, 7, 1, 0, 0, 0, TimeSpan.Zero) });

        ContextPropertyEvaluator.EvaluateEntityFilters(definition, entity).Should().BeTrue();
    }

    [Fact]
    public void EvaluateEntityFilters_DateTimeGreaterThan_FailsWhenBeforeThreshold()
    {
        var definition = CreateDefinition(
            RequirementType.All,
            new FeatureFilter
            {
                Name = "ContextProperty",
                Parameters = new Dictionary<string, string>
                {
                    ["Property"] = "OrderDate",
                    ["Operator"] = "gt",
                    ["Value"] = "2026-06-10T00:00:00Z",
                    ["ValueType"] = "datetime"
                }
            });

        var entity = new TogglyEntityContext(
            "Order",
            "42",
            new Dictionary<string, object?> { ["OrderDate"] = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero) });

        ContextPropertyEvaluator.EvaluateEntityFilters(definition, entity).Should().BeFalse();
    }

    [Fact]
    public void EvaluateEntityFilters_UsesContextRequirementType()
    {
        var definition = CreateDefinition(
            RequirementType.Any,
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
            },
            new FeatureFilter
            {
                Name = "ContextProperty",
                Parameters = new Dictionary<string, string>
                {
                    ["Property"] = "Color",
                    ["Operator"] = "eq",
                    ["Value"] = "blue",
                    ["ValueType"] = "string"
                }
            });
        definition.ContextRequirementType = RequirementType.All;

        var entity = new TogglyEntityContext(
            "Puppy",
            "1",
            new Dictionary<string, object?> { ["Color"] = "red" });

        ContextPropertyEvaluator.EvaluateEntityFilters(definition, entity).Should().BeFalse();
    }

    [Fact]
    public void EvaluateEntityFilters_Neq_FailsClosedWhenAttributeMissing()
    {
        var definition = CreateDefinition(
            RequirementType.All,
            new FeatureFilter
            {
                Name = "ContextProperty",
                Parameters = new Dictionary<string, string>
                {
                    ["Property"] = "Color",
                    ["Operator"] = "neq",
                    ["Value"] = "red",
                    ["ValueType"] = "string"
                }
            });

        var entity = new TogglyEntityContext(
            "Puppy",
            "1",
            new Dictionary<string, object?>());

        ContextPropertyEvaluator.EvaluateEntityFilters(definition, entity).Should().BeFalse();
    }

    [Fact]
    public void EvaluateEntityFilters_EmptyFilterList_FailsClosed()
    {
        var definition = CreateDefinition(RequirementType.All);
        var entity = new TogglyEntityContext("Puppy", "1", new Dictionary<string, object?>());
        ContextPropertyEvaluator.EvaluateEntityFilters(definition, entity).Should().BeFalse();
    }

    [Fact]
    public void EvaluateEntityFilters_LooksUpPropertiesIgnoreCase()
    {
        var definition = CreateDefinition(
            RequirementType.All,
            new FeatureFilter
            {
                Name = "ContextProperty",
                Parameters = new Dictionary<string, string>
                {
                    ["Property"] = "color",
                    ["Operator"] = "eq",
                    ["Value"] = "red",
                    ["ValueType"] = "string"
                }
            });

        var entity = new TogglyEntityContext(
            "Puppy",
            "1",
            new Dictionary<string, object?> { ["Color"] = "red" });

        ContextPropertyEvaluator.EvaluateEntityFilters(definition, entity).Should().BeTrue();
    }

    private static FeatureDefinitionModel CreateDefinition(RequirementType requirementType, params FeatureFilter[] filters)
    {
        return new FeatureDefinitionModel
        {
            FeatureKey = "TestFeature",
            RequirementType = requirementType,
            Filters = new List<FeatureFilter>(filters)
        };
    }
}
