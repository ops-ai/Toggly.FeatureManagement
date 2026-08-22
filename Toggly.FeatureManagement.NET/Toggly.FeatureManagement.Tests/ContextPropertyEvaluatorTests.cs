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
            "Order",
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
            "Order",
            "1",
            new Dictionary<string, object?>());

        ContextPropertyEvaluator.EvaluateEntityFilters(definition, entity).Should().BeFalse();
    }

    [Fact]
    public void EvaluateEntityFilters_EmptyFilterList_FailsClosed()
    {
        var definition = CreateDefinition(RequirementType.All);
        var entity = new TogglyEntityContext("Order", "1", new Dictionary<string, object?>());
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
            "Order",
            "1",
            new Dictionary<string, object?> { ["Color"] = "red" });

        ContextPropertyEvaluator.EvaluateEntityFilters(definition, entity).Should().BeTrue();
    }

    [Fact]
    public void EvaluateEntityFilters_NumberAndInAndContains()
    {
        ContextPropertyEvaluator.EvaluateEntityFilters(
            CreateDefinition(RequirementType.All, Filter("Age", "gte", "2", "number")),
            Entity("Age", 2m)).Should().BeTrue();
        ContextPropertyEvaluator.EvaluateEntityFilters(
            CreateDefinition(RequirementType.All, Filter("Age", "lt", "2", "number")),
            Entity("Age", 3)).Should().BeFalse();
        ContextPropertyEvaluator.EvaluateEntityFilters(
            CreateDefinition(RequirementType.All, Filter("Color", "in", "red, blue", "string")),
            Entity("Color", "BLUE")).Should().BeTrue();
        ContextPropertyEvaluator.EvaluateEntityFilters(
            CreateDefinition(RequirementType.All, Filter("Name", "contains", "pup", "string")),
            Entity("Name", "Order")).Should().BeTrue();
        ContextPropertyEvaluator.EvaluateEntityFilters(
            CreateDefinition(RequirementType.All, Filter("Tags", "contains", "beta", "string[]")),
            Entity("Tags", new object[] { "GA", "Beta" })).Should().BeTrue();
    }

    [Fact]
    public void EvaluateEntityFilters_UnknownOperatorAndMissingParameters_FailClosed()
    {
        ContextPropertyEvaluator.EvaluateEntityFilters(
            CreateDefinition(RequirementType.All, Filter("Color", "matches", "red", "string")),
            Entity("Color", "red")).Should().BeFalse();
        ContextPropertyEvaluator.EvaluateEntityFilters(
            CreateDefinition(RequirementType.All, new FeatureFilter
            {
                Name = "ContextProperty",
                Parameters = new Dictionary<string, string>()
            }),
            Entity("Color", "red")).Should().BeFalse();
    }

    [Fact]
    public void EvaluateEntityFilters_ParsesDateTimeAndIgnoresNonContextFilters()
    {
        var definition = CreateDefinition(
            RequirementType.All,
            new FeatureFilter { Name = "Percentage", Parameters = new Dictionary<string, string> { ["Value"] = "50" } },
            Filter("Born", "gt", "2026-01-01", "datetime"));

        ContextPropertyEvaluator.HasUserFilters(definition).Should().BeTrue();
        ContextPropertyEvaluator.HasEntityFilters(definition).Should().BeTrue();
        ContextPropertyEvaluator.GetUserFilters(definition).Should().ContainSingle();

        ContextPropertyEvaluator.EvaluateEntityFilters(
            definition,
            Entity("Born", new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc))).Should().BeTrue();
        ContextPropertyEvaluator.EvaluateEntityFilters(
            definition,
            Entity("Born", "not-a-date")).Should().BeFalse();
    }

    [Fact]
    public void IsContextPropertyFilter_RejectsNullAndOtherNames()
    {
        ContextPropertyEvaluator.IsContextPropertyFilter(null).Should().BeFalse();
        ContextPropertyEvaluator.IsContextPropertyFilter(new FeatureFilter { Name = "AlwaysOn" }).Should().BeFalse();
    }

    private static FeatureFilter Filter(string property, string op, string value, string valueType) =>
        new()
        {
            Name = "ContextProperty",
            Parameters = new Dictionary<string, string>
            {
                ["Property"] = property,
                ["Operator"] = op,
                ["Value"] = value,
                ["ValueType"] = valueType
            }
        };

    private static TogglyEntityContext Entity(string property, object? value) =>
        new("Order", "1", new Dictionary<string, object?> { [property] = value });

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
