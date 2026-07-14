using FluentAssertions;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class TogglySettingsTests
{
    [Fact]
    public void DefaultValues_AreCorrect()
    {
        // Arrange & Act
        var settings = new TogglySettings();

        // Assert
        settings.AppKey.Should().BeEmpty();
        settings.Environment.Should().Be("Production");
        settings.UseSignedDefinitions.Should().BeFalse();
        settings.BaseUrl.Should().BeNull();
        settings.DefinitionsBaseUrl.Should().BeNull();
        settings.AppVersion.Should().BeNull();
        settings.InstanceName.Should().BeNull();
        settings.UndefinedEnabledOnDevelopment.Should().BeFalse();
        settings.AllowedKeyIds.Should().BeNull();
        settings.JwksCacheDuration.Should().Be(TimeSpan.FromDays(30));
    }

    [Fact]
    public void AllPropertiesCanBeSetAndRetrieved()
    {
        // Arrange & Act
        var settings = new TogglySettings
        {
            AppKey = "test-app-key",
            Environment = "Development",
            UseSignedDefinitions = true,
            BaseUrl = "https://custom.toggly.io",
            DefinitionsBaseUrl = "https://definitions.custom.io",
            AppVersion = "1.0.0",
            InstanceName = "instance-1",
            UndefinedEnabledOnDevelopment = true,
            AllowedKeyIds = new HashSet<string> { "key1", "key2" },
            JwksCacheDuration = TimeSpan.FromHours(12)
        };

        // Assert
        settings.AppKey.Should().Be("test-app-key");
        settings.Environment.Should().Be("Development");
        settings.UseSignedDefinitions.Should().BeTrue();
        settings.BaseUrl.Should().Be("https://custom.toggly.io");
        settings.DefinitionsBaseUrl.Should().Be("https://definitions.custom.io");
        settings.AppVersion.Should().Be("1.0.0");
        settings.InstanceName.Should().Be("instance-1");
        settings.UndefinedEnabledOnDevelopment.Should().BeTrue();
        settings.AllowedKeyIds.Should().Contain("key1");
        settings.AllowedKeyIds.Should().Contain("key2");
        settings.JwksCacheDuration.Should().Be(TimeSpan.FromHours(12));
    }

    [Fact]
    public void AppKey_CanBeSetToEmptyString()
    {
        // Arrange
        var settings = new TogglySettings { AppKey = "some-key" };

        // Act
        settings.AppKey = string.Empty;

        // Assert
        settings.AppKey.Should().BeEmpty();
    }

    [Fact]
    public void Environment_DefaultsToProduction()
    {
        // Arrange & Act
        var settings = new TogglySettings();

        // Assert
        settings.Environment.Should().Be("Production");
    }

    [Fact]
    public void AllowedKeyIds_CanBeInitializedWithValues()
    {
        // Arrange & Act
        var settings = new TogglySettings
        {
            AllowedKeyIds = new HashSet<string> { "key-a", "key-b", "key-c" }
        };

        // Assert
        settings.AllowedKeyIds.Should().HaveCount(3);
        settings.AllowedKeyIds.Should().Contain("key-a");
    }

    [Fact]
    public void AllowedKeyIds_IsHashSet_NoDuplicates()
    {
        // Arrange & Act
        var settings = new TogglySettings
        {
            AllowedKeyIds = new HashSet<string> { "key1", "key1", "key2" }
        };

        // Assert
        settings.AllowedKeyIds.Should().HaveCount(2);
    }
}
