using FluentAssertions;
using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Data;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class FeatureDefinitionModelTests
{
    #region FeatureDefinitionModel.Equals(other) Tests

    [Fact]
    public void Equals_WithIdenticalModels_ReturnsTrue()
    {
        // Arrange
        var model1 = CreateFeatureDefinition("feature1");
        var model2 = CreateFeatureDefinition("feature1");

        // Act
        var result = model1.Equals(model2);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void Equals_WithDifferentFeatureKeys_ReturnsFalse()
    {
        // Arrange
        var model1 = CreateFeatureDefinition("feature1");
        var model2 = CreateFeatureDefinition("feature2");

        // Act
        var result = model1.Equals(model2);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void Equals_WithDifferentFilters_ReturnsFalse()
    {
        // Arrange
        var model1 = CreateFeatureDefinition("feature1", new FeatureFilter { Name = "Filter1" });
        var model2 = CreateFeatureDefinition("feature1", new FeatureFilter { Name = "Filter2" });

        // Act
        var result = model1.Equals(model2);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void Equals_WithNullOther_ReturnsFalse()
    {
        // Arrange
        var model = CreateFeatureDefinition("feature1");

        // Act
        var result = model.Equals((FeatureDefinitionModel?)null);

        // Assert
        result.Should().BeFalse();
    }

    #endregion

    #region FeatureDefinitionModel.Equals(x, y) Tests

    [Fact]
    public void EqualsComparer_WithEquivalentIndependentModels_SupportsHashSetLookup()
    {
        // Arrange
        var model1 = CreateFeatureDefinition("feature1", CreateParameterizedFilter());
        var model2 = CreateFeatureDefinition("feature1", CreateParameterizedFilter());
        var comparer = new FeatureDefinitionModel();
        var models = new HashSet<FeatureDefinitionModel>(comparer) { model1 };

        // Act & Assert
        model1.Equals(model2).Should().BeTrue();
        comparer.Equals(model1, model2).Should().BeTrue();
        comparer.Equals(model2, model1).Should().BeTrue();
        var hash = comparer.GetHashCode(model1);
        comparer.GetHashCode(model2).Should().Be(hash);
        comparer.GetHashCode(model1).Should().Be(hash);
        models.Contains(model2).Should().BeTrue();
        models.Add(model2).Should().BeFalse();
        models.Should().ContainSingle();
    }

    [Theory]
    [InlineData("feature2", "Targeting", "Group", "Beta")]
    [InlineData("feature1", "Percentage", "Group", "Beta")]
    [InlineData("feature1", "Targeting", "Audience", "Beta")]
    [InlineData("feature1", "Targeting", "Group", "EarlyAccess")]
    public void EqualsComparer_WithDifferentKeysOrFilters_ReturnsFalse(
        string featureKey, string filterName, string parameterName, string parameterValue)
    {
        // Arrange
        var model1 = CreateFeatureDefinition("feature1", CreateParameterizedFilter());
        var model2 = CreateFeatureDefinition(featureKey,
            CreateParameterizedFilter(filterName, parameterName, parameterValue));
        var comparer = new FeatureDefinitionModel();

        // Act & Assert
        comparer.Equals(model1, model2).Should().BeFalse();
        comparer.Equals(model2, model1).Should().BeFalse();
    }

    [Fact]
    public void EqualsComparer_WithNullX_ReturnsFalse()
    {
        // Arrange
        var model = CreateFeatureDefinition("feature1");
        var comparer = model as IEqualityComparer<FeatureDefinitionModel>;

        // Act
        var result = comparer.Equals(null, model);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void EqualsComparer_WithNullY_ReturnsFalse()
    {
        // Arrange
        var model = CreateFeatureDefinition("feature1");
        var comparer = model as IEqualityComparer<FeatureDefinitionModel>;

        // Act
        var result = comparer.Equals(model, null);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void EqualsComparer_WithBothNull_ReturnsFalse()
    {
        // Arrange
        var model = CreateFeatureDefinition("feature1");
        var comparer = model as IEqualityComparer<FeatureDefinitionModel>;

        // Act
        var result = comparer.Equals(null, null);

        // Assert
        result.Should().BeFalse();
    }

    #endregion

    #region GetHashCode Tests

    [Fact]
    public void GetHashCode_ForEqualObjects_ProducesSameValue()
    {
        // Arrange
        var model1 = CreateFeatureDefinition("feature1");
        var model2 = CreateFeatureDefinition("feature1");

        // Act
        var hash1 = model1.GetHashCode(model1);
        var hash2 = model2.GetHashCode(model2);

        // Assert
        hash1.Should().Be(hash2);
    }

    [Fact]
    public void GetHashCode_WithParametersInsertedInReverseOrder_ProducesSameValue()
    {
        // Arrange
        var model1 = CreateFeatureDefinition("feature1", CreateParameterizedFilter());
        var model2 = CreateFeatureDefinition("feature1", new FeatureFilter
        {
            Name = "Targeting",
            Parameters = new Dictionary<string, string>
            {
                { "Group", "Beta" },
                { "Value", "50" }
            }
        });
        var comparer = new FeatureDefinitionModel();

        // Act
        var hash1 = comparer.GetHashCode(model1);
        var hash2 = comparer.GetHashCode(model2);

        // Assert
        hash1.Should().Be(hash2);
    }

    [Fact]
    public void GetHashCode_WithNullObject_ReturnsZero()
    {
        // Arrange
        var model = CreateFeatureDefinition("feature1");

        // Act
        var hash = model.GetHashCode(null!);

        // Assert
        hash.Should().Be(0);
    }

    #endregion

    #region FeatureFilter Tests

    [Fact]
    public void FeatureFilter_EqualsComparer_WithEquivalentIndependentFilters_SupportsHashSetLookup()
    {
        // Arrange
        var filter1 = CreateParameterizedFilter();
        var filter2 = CreateParameterizedFilter();
        var comparer = new FeatureFilter();
        var filters = new HashSet<FeatureFilter>(comparer) { filter1 };

        // Act & Assert
        filter1.Equals(filter2).Should().BeTrue();
        comparer.Equals(filter1, filter2).Should().BeTrue();
        comparer.Equals(filter2, filter1).Should().BeTrue();
        var hash = comparer.GetHashCode(filter1);
        comparer.GetHashCode(filter2).Should().Be(hash);
        comparer.GetHashCode(filter1).Should().Be(hash);
        filters.Contains(filter2).Should().BeTrue();
        filters.Add(filter2).Should().BeFalse();
        filters.Should().ContainSingle();
    }

    [Theory]
    [InlineData("Percentage", "Group", "Beta")]
    [InlineData("Targeting", "Audience", "Beta")]
    [InlineData("Targeting", "Group", "EarlyAccess")]
    public void FeatureFilter_EqualsComparer_WithDifferentNamesOrParameters_ReturnsFalse(
        string name, string parameterName, string parameterValue)
    {
        // Arrange
        var filter1 = CreateParameterizedFilter();
        var filter2 = CreateParameterizedFilter(name, parameterName, parameterValue);
        var comparer = new FeatureFilter();

        // Act & Assert
        filter1.Equals(filter2).Should().BeFalse();
        comparer.Equals(filter1, filter2).Should().BeFalse();
        comparer.Equals(filter2, filter1).Should().BeFalse();
    }

    [Fact]
    public void FeatureFilter_EqualsComparer_WithNullParametersOnBothSides_ReturnsTrue()
    {
        // Arrange
        var filter1 = new FeatureFilter { Name = "AlwaysOn", Parameters = null };
        var filter2 = new FeatureFilter { Name = "AlwaysOn", Parameters = null };
        var comparer = new FeatureFilter();

        // Act & Assert
        comparer.Equals(filter1, filter2).Should().BeTrue();
        comparer.Equals(filter2, filter1).Should().BeTrue();
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void FeatureFilter_EqualsComparer_WithNullOperand_ReturnsFalse(bool nullX, bool nullY)
    {
        // Arrange
        var filter = CreateParameterizedFilter();
        var comparer = new FeatureFilter();

        // Act
        var result = comparer.Equals(nullX ? null : filter, nullY ? null : filter);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void FeatureFilter_Equals_WithMatchingParameters_ReturnsTrue()
    {
        // Arrange
        var filter1 = new FeatureFilter
        {
            Name = "Percentage",
            Parameters = new Dictionary<string, string> { { "Value", "50" } }
        };
        var filter2 = new FeatureFilter
        {
            Name = "Percentage",
            Parameters = new Dictionary<string, string> { { "Value", "50" } }
        };

        // Act
        var result = filter1.Equals(filter2);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void FeatureFilter_Equals_WithNullParametersOnBothSides_ReturnsTrue()
    {
        // Arrange
        var filter1 = new FeatureFilter { Name = "AlwaysOn", Parameters = null };
        var filter2 = new FeatureFilter { Name = "AlwaysOn", Parameters = null };

        // Act
        var result = filter1.Equals(filter2);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void FeatureFilter_Equals_WithDifferentParameters_ReturnsFalse()
    {
        // Arrange
        var filter1 = new FeatureFilter
        {
            Name = "Percentage",
            Parameters = new Dictionary<string, string> { { "Value", "50" } }
        };
        var filter2 = new FeatureFilter
        {
            Name = "Percentage",
            Parameters = new Dictionary<string, string> { { "Value", "75" } }
        };

        // Act
        var result = filter1.Equals(filter2);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void FeatureFilter_Equals_WithNull_ReturnsFalse()
    {
        // Arrange
        var filter = new FeatureFilter { Name = "Test" };

        // Act
        var result = filter.Equals((FeatureFilter?)null);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void FeatureFilter_ToString_ReturnsExpectedFormat()
    {
        // Arrange
        var filter = new FeatureFilter { Name = "Percentage" };

        // Act
        var result = filter.ToString();

        // Assert
        result.Should().Contain("Percentage");
        result.Should().Contain("FeatureFilter");
    }

    [Fact]
    public void FeatureFilter_GetHashCode_WithNullFilter_ReturnsZero()
    {
        // Arrange
        var filter = new FeatureFilter { Name = "Test" };

        // Act
        var hash = filter.GetHashCode(null!);

        // Assert
        hash.Should().Be(0);
    }

    [Fact]
    public void FeatureFilter_GetHashCode_WithParametersInsertedInReverseOrder_ProducesSameValue()
    {
        // Arrange
        var filter1 = CreateParameterizedFilter();
        var filter2 = new FeatureFilter
        {
            Name = "Targeting",
            Parameters = new Dictionary<string, string>
            {
                { "Group", "Beta" },
                { "Value", "50" }
            }
        };
        var comparer = new FeatureFilter();

        // Act
        var hash1 = comparer.GetHashCode(filter1);
        var hash2 = comparer.GetHashCode(filter2);

        // Assert
        hash1.Should().Be(hash2);
    }

    [Fact]
    public void FeatureFilter_GetHashCode_WithNullParameters_DoesNotThrow()
    {
        // Arrange
        var filter = new FeatureFilter { Name = "Test", Parameters = null };

        // Act
        var act = () => filter.GetHashCode(filter);

        // Assert
        act.Should().NotThrow();
    }

    #endregion

    #region AlwaysOnFilter Tests

    [Fact]
    public void AlwaysOnFilter_InheritsFromFeatureFilter()
    {
        // Arrange & Act
        var filter = new AlwaysOnFilter { Name = "AlwaysOn" };

        // Assert
        filter.Should().BeAssignableTo<FeatureFilter>();
    }

    #endregion

    #region Model Properties Tests

    [Fact]
    public void FeatureDefinitionModel_RequirementType_DefaultsToAny()
    {
        // Arrange & Act
        var model = new FeatureDefinitionModel();

        // Assert
        model.RequirementType.Should().Be(RequirementType.Any);
    }

    [Fact]
    public void FeatureDefinitionModel_AllPropertiesCanBeSet()
    {
        // Arrange & Act
        var model = new FeatureDefinitionModel
        {
            FeatureKey = "test-feature",
            SecuredFeature = true,
            RequirementType = RequirementType.All,
            Metrics = new List<string> { "metric1" },
            Filters = new List<FeatureFilter>
            {
                new() { Name = "Filter1" }
            }
        };

        // Assert
        model.FeatureKey.Should().Be("test-feature");
        model.SecuredFeature.Should().BeTrue();
        model.RequirementType.Should().Be(RequirementType.All);
        model.Metrics.Should().Contain("metric1");
        model.Filters.Should().HaveCount(1);
    }

    #endregion

    private static FeatureDefinitionModel CreateFeatureDefinition(string featureKey, params FeatureFilter[] filters)
    {
        return new FeatureDefinitionModel
        {
            FeatureKey = featureKey,
            Filters = filters.Length > 0 ? filters.ToList() : new List<FeatureFilter>
            {
                new AlwaysOnFilter { Name = "AlwaysOn" }
            }
        };
    }

    private static FeatureFilter CreateParameterizedFilter(
        string name = "Targeting", string parameterName = "Group", string parameterValue = "Beta")
    {
        return new FeatureFilter
        {
            Name = name,
            Parameters = new Dictionary<string, string>
            {
                ["Value"] = "50",
                [parameterName] = parameterValue
            }
        };
    }
}
