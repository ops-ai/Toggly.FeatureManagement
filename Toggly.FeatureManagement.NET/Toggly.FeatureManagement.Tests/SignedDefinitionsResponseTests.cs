using FluentAssertions;
using System.Text.Json;
using Toggly.FeatureManagement.Data;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class SignedDefinitionsResponseTests
{
    #region Property Tests

    [Fact]
    public void Defs_CanBeSetAndRetrieved()
    {
        // Arrange
        var response = new SignedDefinitionsResponse();
        var defs = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "feature1" },
            new() { FeatureKey = "feature2" }
        };

        // Act
        response.Defs = defs;

        // Assert
        response.Defs.Should().HaveCount(2);
        response.Defs[0].FeatureKey.Should().Be("feature1");
        response.Defs[1].FeatureKey.Should().Be("feature2");
    }

    [Fact]
    public void Signature_CanBeSetAndRetrieved()
    {
        // Arrange
        var response = new SignedDefinitionsResponse();

        // Act
        response.Signature = "test-signature-abc123";

        // Assert
        response.Signature.Should().Be("test-signature-abc123");
    }

    [Fact]
    public void Timestamp_CanBeSetAndRetrieved()
    {
        // Arrange
        var response = new SignedDefinitionsResponse();

        // Act
        response.Timestamp = 1700000000L;

        // Assert
        response.Timestamp.Should().Be(1700000000L);
    }

    [Fact]
    public void Kid_CanBeSetAndRetrieved()
    {
        // Arrange
        var response = new SignedDefinitionsResponse();

        // Act
        response.Kid = "key-id-xyz789";

        // Assert
        response.Kid.Should().Be("key-id-xyz789");
    }

    #endregion

    #region Object Initialization Tests

    [Fact]
    public void ObjectInitializer_SetsAllProperties()
    {
        // Arrange & Act
        var response = new SignedDefinitionsResponse
        {
            Defs = new List<FeatureDefinitionModel>
            {
                new() { FeatureKey = "test-feature" }
            },
            Signature = "sig-123",
            Timestamp = 1234567890L,
            Kid = "key-456"
        };

        // Assert
        response.Defs.Should().HaveCount(1);
        response.Defs[0].FeatureKey.Should().Be("test-feature");
        response.Signature.Should().Be("sig-123");
        response.Timestamp.Should().Be(1234567890L);
        response.Kid.Should().Be("key-456");
    }

    [Fact]
    public void Defs_CanContainComplexFeatureDefinitions()
    {
        // Arrange & Act
        var response = new SignedDefinitionsResponse
        {
            Defs = new List<FeatureDefinitionModel>
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
            },
            Signature = "complex-sig",
            Timestamp = 9999999999L,
            Kid = "complex-key"
        };

        // Assert
        var feature = response.Defs[0];
        feature.FeatureKey.Should().Be("complex-feature");
        feature.RequirementType.Should().Be(Microsoft.FeatureManagement.RequirementType.All);
        feature.Filters.Should().HaveCount(1);
        feature.Metrics.Should().Contain("metric1");
    }

    #endregion

    #region JSON Serialization Tests

    [Fact]
    public void Serialization_UsesCorrectJsonPropertyNames()
    {
        // Arrange
        var response = new SignedDefinitionsResponse
        {
            Defs = new List<FeatureDefinitionModel>
            {
                new() { FeatureKey = "feature1" }
            },
            Signature = "test-signature",
            Timestamp = 1700000000L,
            Kid = "test-key"
        };

        // Act
        var json = JsonSerializer.Serialize(response);

        // Assert
        json.Should().Contain("\"defs\":");
        json.Should().Contain("\"signature\":");
        json.Should().Contain("\"timestamp\":");
        json.Should().Contain("\"kid\":");
    }

    [Fact]
    public void Deserialization_WorksWithJsonPropertyNames()
    {
        // Arrange
        var json = """
        {
            "defs": [{"featureKey": "deserialized-feature"}],
            "signature": "deserialized-sig",
            "timestamp": 1234567890,
            "kid": "deserialized-key"
        }
        """;

        // Act
        var response = JsonSerializer.Deserialize<SignedDefinitionsResponse>(json);

        // Assert
        response.Should().NotBeNull();
        response!.Defs.Should().HaveCount(1);
        response.Signature.Should().Be("deserialized-sig");
        response.Timestamp.Should().Be(1234567890L);
        response.Kid.Should().Be("deserialized-key");
    }

    [Fact]
    public void RoundTrip_SerializationPreservesAllData()
    {
        // Arrange
        var original = new SignedDefinitionsResponse
        {
            Defs = new List<FeatureDefinitionModel>
            {
                new() { FeatureKey = "feature1" },
                new() { FeatureKey = "feature2" }
            },
            Signature = "round-trip-signature",
            Timestamp = 9876543210L,
            Kid = "round-trip-key"
        };

        // Act
        var json = JsonSerializer.Serialize(original);
        var deserialized = JsonSerializer.Deserialize<SignedDefinitionsResponse>(json);

        // Assert
        deserialized.Should().NotBeNull();
        deserialized!.Defs.Should().NotBeNull().And.HaveCount(2);
        deserialized.Defs![0].FeatureKey.Should().Be("feature1");
        deserialized.Defs[1].FeatureKey.Should().Be("feature2");
        deserialized.Signature.Should().Be("round-trip-signature");
        deserialized.Timestamp.Should().Be(9876543210L);
        deserialized.Kid.Should().Be("round-trip-key");
    }

    #endregion
}
