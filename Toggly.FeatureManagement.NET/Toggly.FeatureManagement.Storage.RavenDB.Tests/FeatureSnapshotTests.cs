using FluentAssertions;
using Toggly.FeatureManagement.Data;
using Xunit;

namespace Toggly.FeatureManagement.Storage.RavenDB.Tests;

public class FeatureSnapshotTests
{
    #region Property Tests

    [Fact]
    public void Id_CanBeSetAndRetrieved()
    {
        // Arrange & Act
        var snapshot = new FeatureSnapshot
        {
            Id = "FeatureSnapshots/Custom"
        };

        // Assert
        snapshot.Id.Should().Be("FeatureSnapshots/Custom");
    }

    [Fact]
    public void Features_CanBeSetAndRetrieved()
    {
        // Arrange
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "Feature1", Filters = new List<FeatureFilter>() },
            new() { FeatureKey = "Feature2", Filters = new List<FeatureFilter>() }
        };

        // Act
        var snapshot = new FeatureSnapshot
        {
            Features = features
        };

        // Assert
        snapshot.Features.Should().HaveCount(2);
        snapshot.Features[0].FeatureKey.Should().Be("Feature1");
        snapshot.Features[1].FeatureKey.Should().Be("Feature2");
    }

    [Fact]
    public void Signature_CanBeSetAndRetrieved()
    {
        // Arrange & Act
        var snapshot = new FeatureSnapshot
        {
            Signature = "test-signature-value"
        };

        // Assert
        snapshot.Signature.Should().Be("test-signature-value");
    }

    [Fact]
    public void Signature_CanBeNull()
    {
        // Arrange & Act
        var snapshot = new FeatureSnapshot
        {
            Signature = null
        };

        // Assert
        snapshot.Signature.Should().BeNull();
    }

    [Fact]
    public void KeyId_CanBeSetAndRetrieved()
    {
        // Arrange & Act
        var snapshot = new FeatureSnapshot
        {
            KeyId = "key-12345"
        };

        // Assert
        snapshot.KeyId.Should().Be("key-12345");
    }

    [Fact]
    public void KeyId_CanBeNull()
    {
        // Arrange & Act
        var snapshot = new FeatureSnapshot
        {
            KeyId = null
        };

        // Assert
        snapshot.KeyId.Should().BeNull();
    }

    [Fact]
    public void Timestamp_CanBeSetAndRetrieved()
    {
        // Arrange & Act
        var snapshot = new FeatureSnapshot
        {
            Timestamp = 1700000000L
        };

        // Assert
        snapshot.Timestamp.Should().Be(1700000000L);
    }

    [Fact]
    public void Timestamp_CanBeNull()
    {
        // Arrange & Act
        var snapshot = new FeatureSnapshot
        {
            Timestamp = null
        };

        // Assert
        snapshot.Timestamp.Should().BeNull();
    }

    #endregion

    #region Object Initializer Tests

    [Fact]
    public void ObjectInitializer_SetsAllProperties()
    {
        // Arrange
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "TestFeature", Filters = new List<FeatureFilter>() }
        };

        // Act
        var snapshot = new FeatureSnapshot
        {
            Id = "FeatureSnapshots/Test",
            Features = features,
            Signature = "sig-abc",
            KeyId = "kid-xyz",
            Timestamp = 9876543210L
        };

        // Assert
        snapshot.Id.Should().Be("FeatureSnapshots/Test");
        snapshot.Features.Should().HaveCount(1);
        snapshot.Features[0].FeatureKey.Should().Be("TestFeature");
        snapshot.Signature.Should().Be("sig-abc");
        snapshot.KeyId.Should().Be("kid-xyz");
        snapshot.Timestamp.Should().Be(9876543210L);
    }

    [Fact]
    public void ObjectInitializer_WithEmptyFeaturesList_SetsEmptyList()
    {
        // Arrange & Act
        var snapshot = new FeatureSnapshot
        {
            Id = "FeatureSnapshots/Empty",
            Features = new List<FeatureDefinitionModel>()
        };

        // Assert
        snapshot.Features.Should().BeEmpty();
    }

    #endregion
}
