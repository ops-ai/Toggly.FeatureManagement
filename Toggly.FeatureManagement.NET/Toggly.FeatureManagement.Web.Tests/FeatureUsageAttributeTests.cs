using FluentAssertions;
using Microsoft.FeatureManagement;
using Xunit;

namespace Toggly.FeatureManagement.Web.Tests;

public class FeatureUsageAttributeTests
{
    #region Constructor Tests (String Features)

    [Fact]
    public void Constructor_WithStringFeatures_StoresThem()
    {
        // Arrange & Act
        var attribute = new FeatureUsageAttribute("feature1", "feature2");

        // Assert
        attribute.Features.Should().BeEquivalentTo(new[] { "feature1", "feature2" });
    }

    [Fact]
    public void Constructor_WithNullFeatures_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new FeatureUsageAttribute((string[]?)null!);
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Constructor_WithEmptyFeatures_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new FeatureUsageAttribute(Array.Empty<string>());
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Constructor_WithSingleFeature_StoresIt()
    {
        // Arrange & Act
        var attribute = new FeatureUsageAttribute("single-feature");

        // Assert
        attribute.Features.Should().ContainSingle().Which.Should().Be("single-feature");
    }

    #endregion

    #region Constructor Tests (Enum Features)

    [Fact]
    public void Constructor_WithEnumFeatures_ConvertsToStrings()
    {
        // Arrange & Act
        var attribute = new FeatureUsageAttribute(TestFeatures.FeatureA, TestFeatures.FeatureB);

        // Assert
        attribute.Features.Should().BeEquivalentTo(new[] { "FeatureA", "FeatureB" });
    }

    [Fact]
    public void Constructor_WithNonEnumObjects_ThrowsArgumentException()
    {
        // Act & Assert
        var act = () => new FeatureUsageAttribute(123, 456);
        act.Should().Throw<ArgumentException>().WithMessage("*enums*");
    }

    [Fact]
    public void Constructor_WithMixedEnumTypes_ConvertsAll()
    {
        // Arrange & Act
        var attribute = new FeatureUsageAttribute(TestFeatures.FeatureA, OtherFeatures.Beta);

        // Assert
        attribute.Features.Should().BeEquivalentTo(new[] { "FeatureA", "Beta" });
    }

    [Fact]
    public void Constructor_WithNullEnumFeatures_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new FeatureUsageAttribute((object[]?)null!);
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Constructor_WithEmptyEnumFeatures_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new FeatureUsageAttribute(Array.Empty<object>());
        act.Should().Throw<ArgumentNullException>();
    }

    #endregion

    #region RequirementType Tests

    [Fact]
    public void RequirementType_DefaultsToAll()
    {
        // Arrange & Act
        var attribute = new FeatureUsageAttribute("feature");

        // Assert
        attribute.RequirementType.Should().Be(RequirementType.All);
    }

    [Fact]
    public void RequirementType_CanBeSetToAny()
    {
        // Arrange
        var attribute = new FeatureUsageAttribute("feature")
        {
            // Act
            RequirementType = RequirementType.Any
        };

        // Assert
        attribute.RequirementType.Should().Be(RequirementType.Any);
    }

    #endregion

    #region AttributeUsage Tests

    [Fact]
    public void Attribute_CanBeAppliedToMethods()
    {
        // Arrange & Assert
        var attributeUsage = typeof(FeatureUsageAttribute)
            .GetCustomAttributes(typeof(AttributeUsageAttribute), false)
            .Cast<AttributeUsageAttribute>()
            .FirstOrDefault();

        attributeUsage.Should().NotBeNull();
        attributeUsage!.ValidOn.Should().HaveFlag(AttributeTargets.Method);
    }

    [Fact]
    public void Attribute_CanBeAppliedToClasses()
    {
        // Arrange & Assert
        var attributeUsage = typeof(FeatureUsageAttribute)
            .GetCustomAttributes(typeof(AttributeUsageAttribute), false)
            .Cast<AttributeUsageAttribute>()
            .FirstOrDefault();

        attributeUsage.Should().NotBeNull();
        attributeUsage!.ValidOn.Should().HaveFlag(AttributeTargets.Class);
    }

    [Fact]
    public void Attribute_AllowsMultiple()
    {
        // Arrange & Assert
        var attributeUsage = typeof(FeatureUsageAttribute)
            .GetCustomAttributes(typeof(AttributeUsageAttribute), false)
            .Cast<AttributeUsageAttribute>()
            .FirstOrDefault();

        attributeUsage.Should().NotBeNull();
        attributeUsage!.AllowMultiple.Should().BeTrue();
    }

    #endregion

    private enum TestFeatures
    {
        FeatureA,
        FeatureB,
        FeatureC
    }

    private enum OtherFeatures
    {
        Alpha,
        Beta
    }
}
