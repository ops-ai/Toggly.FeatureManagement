using FluentAssertions;
using Xunit;

namespace Toggly.FeatureManagement.Storage.RavenDB.Tests;

public class TogglySnapshotSettingsTests
{
    #region Property Tests

    [Fact]
    public void DocumentName_CanBeSetAndRetrieved()
    {
        // Arrange & Act
        var settings = new TogglySnapshotSettings
        {
            DocumentName = "FeatureSnapshots/Custom"
        };

        // Assert
        settings.DocumentName.Should().Be("FeatureSnapshots/Custom");
    }

    [Fact]
    public void JwkDocumentName_CanBeSetAndRetrieved()
    {
        // Arrange & Act
        var settings = new TogglySnapshotSettings
        {
            JwkDocumentName = "JwkSnapshots/Custom"
        };

        // Assert
        settings.JwkDocumentName.Should().Be("JwkSnapshots/Custom");
    }

    [Fact]
    public void AllProperties_CanBeSetTogether()
    {
        // Arrange & Act
        var settings = new TogglySnapshotSettings
        {
            DocumentName = "Features/MyApp",
            JwkDocumentName = "Jwks/MyApp"
        };

        // Assert
        settings.DocumentName.Should().Be("Features/MyApp");
        settings.JwkDocumentName.Should().Be("Jwks/MyApp");
    }

    [Fact]
    public void DefaultConstructor_InitializesProperties()
    {
        // Act
        var settings = new TogglySnapshotSettings();

        // Assert
        // Properties should be null by default (no explicit default values in the class)
        settings.DocumentName.Should().BeNull();
        settings.JwkDocumentName.Should().BeNull();
    }

    #endregion
}
