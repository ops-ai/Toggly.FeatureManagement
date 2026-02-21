using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using Moq;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class TogglyFeatureManagerTests
{
    private readonly Mock<IFeatureManager> _innerFeatureManagerMock;
    private readonly Mock<IFeatureUsageStatsProvider> _usageStatsProviderMock;
    private readonly Mock<ISecureFeatureProvider> _secureFeatureProviderMock;
    private readonly Mock<IFeatureAuthorizationService> _authorizationServiceMock;
    private readonly ServiceCollection _services;

    public TogglyFeatureManagerTests()
    {
        _innerFeatureManagerMock = new Mock<IFeatureManager>();
        _usageStatsProviderMock = new Mock<IFeatureUsageStatsProvider>();
        _secureFeatureProviderMock = new Mock<ISecureFeatureProvider>();
        _authorizationServiceMock = new Mock<IFeatureAuthorizationService>();
        _services = new ServiceCollection();
    }

    private TogglyFeatureManager CreateManager(bool includeAuthService = false)
    {
        if (includeAuthService)
        {
            _services.AddSingleton(_authorizationServiceMock.Object);
        }

        var serviceProvider = _services.BuildServiceProvider();

        return new TogglyFeatureManager(
            _innerFeatureManagerMock.Object,
            _usageStatsProviderMock.Object,
            _secureFeatureProviderMock.Object,
            serviceProvider);
    }

    #region IsEnabledAsync Tests

    [Fact]
    public async Task IsEnabledAsync_WhenInnerManagerReturnsTrue_ReturnsTrue()
    {
        // Arrange
        const string featureKey = "test-feature";
        _innerFeatureManagerMock.Setup(m => m.IsEnabledAsync(featureKey)).ReturnsAsync(true);
        _secureFeatureProviderMock.Setup(m => m.IsFeatureSecured(featureKey)).Returns(false);

        var manager = CreateManager();

        // Act
        var result = await manager.IsEnabledAsync(featureKey);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task IsEnabledAsync_WhenInnerManagerReturnsFalse_ReturnsFalse()
    {
        // Arrange
        const string featureKey = "test-feature";
        _innerFeatureManagerMock.Setup(m => m.IsEnabledAsync(featureKey)).ReturnsAsync(false);

        var manager = CreateManager();

        // Act
        var result = await manager.IsEnabledAsync(featureKey);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task IsEnabledAsync_RecordsCheckWithCorrectFeatureKeyAndResult()
    {
        // Arrange
        const string featureKey = "test-feature";
        _innerFeatureManagerMock.Setup(m => m.IsEnabledAsync(featureKey)).ReturnsAsync(true);
        _secureFeatureProviderMock.Setup(m => m.IsFeatureSecured(featureKey)).Returns(false);

        var manager = CreateManager();

        // Act
        await manager.IsEnabledAsync(featureKey);

        // Assert
        _usageStatsProviderMock.Verify(
            m => m.RecordCheckAsync(featureKey, true),
            Times.Once);
    }

    [Fact]
    public async Task IsEnabledAsync_WhenFeatureDisabled_RecordsCheckWithFalse()
    {
        // Arrange
        const string featureKey = "test-feature";
        _innerFeatureManagerMock.Setup(m => m.IsEnabledAsync(featureKey)).ReturnsAsync(false);

        var manager = CreateManager();

        // Act
        await manager.IsEnabledAsync(featureKey);

        // Assert
        _usageStatsProviderMock.Verify(
            m => m.RecordCheckAsync(featureKey, false),
            Times.Once);
    }

    [Fact]
    public async Task IsEnabledAsync_WithSecuredFeature_CallsAuthorizationService()
    {
        // Arrange
        const string featureKey = "secured-feature";
        _innerFeatureManagerMock.Setup(m => m.IsEnabledAsync(featureKey)).ReturnsAsync(true);
        _secureFeatureProviderMock.Setup(m => m.IsFeatureSecured(featureKey)).Returns(true);
        _authorizationServiceMock.Setup(m => m.IsAllowedAsync(featureKey)).ReturnsAsync(true);

        var manager = CreateManager(includeAuthService: true);

        // Act
        await manager.IsEnabledAsync(featureKey);

        // Assert
        _authorizationServiceMock.Verify(
            m => m.IsAllowedAsync(featureKey),
            Times.Once);
    }

    [Fact]
    public async Task IsEnabledAsync_WithSecuredFeature_WhenAuthorizationDenied_ReturnsFalse()
    {
        // Arrange
        const string featureKey = "secured-feature";
        _innerFeatureManagerMock.Setup(m => m.IsEnabledAsync(featureKey)).ReturnsAsync(true);
        _secureFeatureProviderMock.Setup(m => m.IsFeatureSecured(featureKey)).Returns(true);
        _authorizationServiceMock.Setup(m => m.IsAllowedAsync(featureKey)).ReturnsAsync(false);

        var manager = CreateManager(includeAuthService: true);

        // Act
        var result = await manager.IsEnabledAsync(featureKey);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task IsEnabledAsync_WithSecuredFeature_WhenAuthorizationAllowed_ReturnsTrue()
    {
        // Arrange
        const string featureKey = "secured-feature";
        _innerFeatureManagerMock.Setup(m => m.IsEnabledAsync(featureKey)).ReturnsAsync(true);
        _secureFeatureProviderMock.Setup(m => m.IsFeatureSecured(featureKey)).Returns(true);
        _authorizationServiceMock.Setup(m => m.IsAllowedAsync(featureKey)).ReturnsAsync(true);

        var manager = CreateManager(includeAuthService: true);

        // Act
        var result = await manager.IsEnabledAsync(featureKey);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task IsEnabledAsync_WithSecuredFeature_NoAuthService_ReturnsEnabled()
    {
        // Arrange
        const string featureKey = "secured-feature";
        _innerFeatureManagerMock.Setup(m => m.IsEnabledAsync(featureKey)).ReturnsAsync(true);
        _secureFeatureProviderMock.Setup(m => m.IsFeatureSecured(featureKey)).Returns(true);

        // No auth service registered
        var manager = CreateManager(includeAuthService: false);

        // Act
        var result = await manager.IsEnabledAsync(featureKey);

        // Assert
        result.Should().BeTrue();
    }

    #endregion

    #region IsEnabledAsync<TContext> Tests

    [Fact]
    public async Task IsEnabledAsyncWithContext_WhenEnabled_ReturnsTrue()
    {
        // Arrange
        const string featureKey = "test-feature";
        var context = new { UserId = "user-123" };
        _innerFeatureManagerMock.Setup(m => m.IsEnabledAsync(featureKey, context)).ReturnsAsync(true);
        _secureFeatureProviderMock.Setup(m => m.IsFeatureSecured(featureKey)).Returns(false);

        var manager = CreateManager();

        // Act
        var result = await manager.IsEnabledAsync(featureKey, context);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task IsEnabledAsyncWithContext_RecordsUsageWithContext()
    {
        // Arrange
        const string featureKey = "test-feature";
        var context = new { UserId = "user-123" };
        _innerFeatureManagerMock.Setup(m => m.IsEnabledAsync(featureKey, context)).ReturnsAsync(true);
        _secureFeatureProviderMock.Setup(m => m.IsFeatureSecured(featureKey)).Returns(false);

        var manager = CreateManager();

        // Act
        await manager.IsEnabledAsync(featureKey, context);

        // Assert
        _usageStatsProviderMock.Verify(
            m => m.RecordUsageAsync(featureKey, context, true),
            Times.Once);
    }

    [Fact]
    public async Task IsEnabledAsyncWithContext_WithSecuredFeature_ChecksAuthorization()
    {
        // Arrange
        const string featureKey = "secured-feature";
        var context = new { UserId = "user-123" };
        _innerFeatureManagerMock.Setup(m => m.IsEnabledAsync(featureKey, context)).ReturnsAsync(true);
        _secureFeatureProviderMock.Setup(m => m.IsFeatureSecured(featureKey)).Returns(true);
        _authorizationServiceMock.Setup(m => m.IsAllowedAsync(featureKey)).ReturnsAsync(false);

        var manager = CreateManager(includeAuthService: true);

        // Act
        var result = await manager.IsEnabledAsync(featureKey, context);

        // Assert
        result.Should().BeFalse();
        _authorizationServiceMock.Verify(m => m.IsAllowedAsync(featureKey), Times.Once);
    }

    #endregion

    #region GetFeatureNamesAsync Tests

    [Fact]
    public async Task GetFeatureNamesAsync_DelegatesToInnerManager()
    {
        // Arrange
        var featureNames = new List<string> { "feature1", "feature2", "feature3" };
        _innerFeatureManagerMock.Setup(m => m.GetFeatureNamesAsync())
            .Returns(featureNames.ToAsyncEnumerable());

        var manager = CreateManager();

        // Act
        var result = new List<string>();
        await foreach (var name in manager.GetFeatureNamesAsync())
        {
            result.Add(name);
        }

        // Assert
        result.Should().BeEquivalentTo(featureNames);
    }

    [Fact]
    public async Task GetFeatureNamesAsync_WhenEmpty_ReturnsEmpty()
    {
        // Arrange
        var featureNames = new List<string>();
        _innerFeatureManagerMock.Setup(m => m.GetFeatureNamesAsync())
            .Returns(featureNames.ToAsyncEnumerable());

        var manager = CreateManager();

        // Act
        var result = new List<string>();
        await foreach (var name in manager.GetFeatureNamesAsync())
        {
            result.Add(name);
        }

        // Assert
        result.Should().BeEmpty();
    }

    #endregion
}
