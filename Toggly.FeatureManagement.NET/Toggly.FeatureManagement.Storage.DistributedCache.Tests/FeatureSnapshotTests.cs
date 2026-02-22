using FluentAssertions;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Storage.DistributedCache;
using Xunit;

namespace Toggly.FeatureManagement.Storage.DistributedCache.Tests;

public class FeatureSnapshotTests
{
    #region Property Tests

    [Fact]
    public void Id_CanBeSetAndRetrieved()
    {
        // Arrange
        var snapshot = new FeatureSnapshot();

        // Act
        snapshot.Id = "FeatureSnapshots/Test";

        // Assert
        snapshot.Id.Should().Be("FeatureSnapshots/Test");
    }

    [Fact]
    public void Features_CanBeSetAndRetrieved()
    {
        // Arrange
        var snapshot = new FeatureSnapshot();
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "feature1" },
            new() { FeatureKey = "feature2" }
        };

        // Act
        snapshot.Features = features;

        // Assert
        snapshot.Features.Should().HaveCount(2);
        snapshot.Features[0].FeatureKey.Should().Be("feature1");
        snapshot.Features[1].FeatureKey.Should().Be("feature2");
    }

    [Fact]
    public void Signature_CanBeSetAndRetrieved()
    {
        // Arrange
        var snapshot = new FeatureSnapshot();

        // Act
        snapshot.Signature = "test-signature-abc123";

        // Assert
        snapshot.Signature.Should().Be("test-signature-abc123");
    }

    [Fact]
    public void Signature_CanBeNull()
    {
        // Arrange
        var snapshot = new FeatureSnapshot();

        // Act
        snapshot.Signature = null;

        // Assert
        snapshot.Signature.Should().BeNull();
    }

    [Fact]
    public void KeyId_CanBeSetAndRetrieved()
    {
        // Arrange
        var snapshot = new FeatureSnapshot();

        // Act
        snapshot.KeyId = "key-id-xyz789";

        // Assert
        snapshot.KeyId.Should().Be("key-id-xyz789");
    }

    [Fact]
    public void KeyId_CanBeNull()
    {
        // Arrange
        var snapshot = new FeatureSnapshot();

        // Act
        snapshot.KeyId = null;

        // Assert
        snapshot.KeyId.Should().BeNull();
    }

    [Fact]
    public void Timestamp_CanBeSetAndRetrieved()
    {
        // Arrange
        var snapshot = new FeatureSnapshot();

        // Act
        snapshot.Timestamp = 1700000000L;

        // Assert
        snapshot.Timestamp.Should().Be(1700000000L);
    }

    [Fact]
    public void Timestamp_CanBeNull()
    {
        // Arrange
        var snapshot = new FeatureSnapshot();

        // Act
        snapshot.Timestamp = null;

        // Assert
        snapshot.Timestamp.Should().BeNull();
    }

    #endregion

    #region Object Initialization Tests

    [Fact]
    public void Constructor_CreatesEmptySnapshot()
    {
        // Act
        var snapshot = new FeatureSnapshot();

        // Assert - Default values should be null/default
        snapshot.Id.Should().BeNull();
        snapshot.Features.Should().BeNull();
        snapshot.Signature.Should().BeNull();
        snapshot.KeyId.Should().BeNull();
        snapshot.Timestamp.Should().BeNull();
    }

    [Fact]
    public void ObjectInitializer_SetsAllProperties()
    {
        // Arrange & Act
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "test-feature" }
        };

        var snapshot = new FeatureSnapshot
        {
            Id = "FeatureSnapshots/Custom",
            Features = features,
            Signature = "sig-123",
            KeyId = "key-456",
            Timestamp = 1234567890L
        };

        // Assert
        snapshot.Id.Should().Be("FeatureSnapshots/Custom");
        snapshot.Features.Should().HaveCount(1);
        snapshot.Features[0].FeatureKey.Should().Be("test-feature");
        snapshot.Signature.Should().Be("sig-123");
        snapshot.KeyId.Should().Be("key-456");
        snapshot.Timestamp.Should().Be(1234567890L);
    }

    [Fact]
    public void Features_CanContainComplexFeatureDefinitions()
    {
        // Arrange & Act
        var snapshot = new FeatureSnapshot
        {
            Id = "FeatureSnapshots/Complex",
            Features = new List<FeatureDefinitionModel>
            {
                new()
                {
                    FeatureKey = "complex-feature",
                    RequirementType = Microsoft.FeatureManagement.RequirementType.All,
                    Filters = new List<FeatureFilter>
                    {
                        new() { Name = "Percentage", Parameters = new Dictionary<string, string> { { "Value", "50" } } }
                    },
                    Metrics = new List<string> { "metric1", "metric2" }
                }
            }
        };

        // Assert
        snapshot.Features.Should().HaveCount(1);
        var feature = snapshot.Features[0];
        feature.FeatureKey.Should().Be("complex-feature");
        feature.RequirementType.Should().Be(Microsoft.FeatureManagement.RequirementType.All);
        feature.Filters.Should().HaveCount(1);
        feature.Filters![0].Name.Should().Be("Percentage");
        feature.Metrics.Should().Contain("metric1");
    }

    #endregion
}
