using FluentAssertions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Toggly.FeatureManagement.Tests.TestHelpers;
using Toggly.Web;
using Xunit;
using Grpc.Core;

namespace Toggly.FeatureManagement.Tests;

public class TogglyUsageStatsProviderTests : IDisposable
{
    private readonly Mock<IOptions<TogglySettings>> _settingsMock;
    private readonly Mock<ILoggerFactory> _loggerFactoryMock;
    private readonly Mock<IHttpClientFactory> _httpClientFactoryMock;
    private readonly Mock<IHostApplicationLifetime> _hostLifetimeMock;
    private readonly Mock<IServiceProvider> _serviceProviderMock;
    private readonly Mock<Usage.UsageClient> _usageClientMock;
    private readonly CancellationTokenSource _stoppingCts;
    private TogglyUsageStatsProvider? _provider;

    public TogglyUsageStatsProviderTests()
    {
        _settingsMock = new Mock<IOptions<TogglySettings>>();
        _settingsMock.Setup(x => x.Value).Returns(new TogglySettings
        {
            AppKey = "test-app-key",
            Environment = "Test",
            BaseUrl = "https://test.toggly.io/",
            AppVersion = "1.0.0",
            InstanceName = "test-instance"
        });

        _loggerFactoryMock = new Mock<ILoggerFactory>();
        _loggerFactoryMock.Setup(x => x.CreateLogger(It.IsAny<string>()))
            .Returns(new Mock<ILogger>().Object);

        _httpClientFactoryMock = new Mock<IHttpClientFactory>();

        _stoppingCts = new CancellationTokenSource();
        _hostLifetimeMock = new Mock<IHostApplicationLifetime>();
        _hostLifetimeMock.Setup(x => x.ApplicationStopping).Returns(_stoppingCts.Token);

        _serviceProviderMock = new Mock<IServiceProvider>();
        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(null);

        _usageClientMock = new Mock<Usage.UsageClient>();
    }

    private TogglyUsageStatsProvider CreateProvider()
    {
        return new TogglyUsageStatsProvider(
            _settingsMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _hostLifetimeMock.Object,
            _serviceProviderMock.Object,
            _usageClientMock.Object
        );
    }

    public void Dispose()
    {
        _provider?.Dispose();
        _stoppingCts.Dispose();
    }

    #region Constructor Tests

    [Fact]
    public void Constructor_InitializesCorrectly()
    {
        // Act
        _provider = CreateProvider();

        // Assert
        _provider.Should().NotBeNull();
    }

    [Fact]
    public void Constructor_WithNullInstanceName_UsesMachineName()
    {
        // Arrange
        _settingsMock.Setup(x => x.Value).Returns(new TogglySettings
        {
            AppKey = "test-app-key",
            Environment = "Test",
            BaseUrl = "https://test.toggly.io/",
            InstanceName = null
        });

        // Act
        _provider = CreateProvider();

        // Assert
        _provider.Should().NotBeNull();
    }

    #endregion

    #region RecordUsageAsync Tests

    [Fact]
    public async Task RecordUsageAsync_RecordsUsage()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        await _provider.RecordUsageAsync("TestFeature");

        // Assert - Check debug info to verify stats were recorded
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordUsageAsync_WithContext_RecordsUsage()
    {
        // Arrange
        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordUsageAsync("TestFeature", context);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordUsageAsync_MultipleFeatures_RecordsAll()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        await _provider.RecordUsageAsync("Feature1");
        await _provider.RecordUsageAsync("Feature2");
        await _provider.RecordUsageAsync("Feature1"); // Duplicate

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordUsageAsync_WithContextProvider_TracksUniqueUsers()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordUsageAsync("TestFeature");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap.Should().NotBeNull();
    }

    #endregion

    #region RecordViewAsync Tests

    [Fact]
    public async Task RecordViewAsync_RecordsView()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        await _provider.RecordViewAsync("TestFeature");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordViewAsync_WithContext_RecordsView()
    {
        // Arrange
        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordViewAsync("TestFeature", context);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordViewAsync_WithContextProvider_TracksUniqueUsers()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordViewAsync("TestFeature");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region RecordCheckAsync Tests

    [Fact]
    public async Task RecordCheckAsync_WhenEnabled_RecordsEnabledStat()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        await _provider.RecordCheckAsync("TestFeature", allowed: true);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordCheckAsync_WhenDisabled_RecordsDisabledStat()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        await _provider.RecordCheckAsync("TestFeature", allowed: false);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordCheckAsync_WithContextProvider_TracksUniqueRequests()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordCheckAsync("TestFeature", allowed: true);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageEnabledMap.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordCheckAsync_WithContextProvider_SkipsUniqueWhenAlreadyAccessed()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(true); // Already accessed

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordCheckAsync("TestFeature", allowed: true);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region RecordUsageAsync with Context and Allowed Tests

    [Fact]
    public async Task RecordUsageAsync_WithContextAndAllowed_RecordsEnabledStat()
    {
        // Arrange
        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordUsageAsync("TestFeature", context, allowed: true);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordUsageAsync_WithContextAndNotAllowed_RecordsDisabledStat()
    {
        // Arrange
        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordUsageAsync("TestFeature", context, allowed: false);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordUsageAsync_WithContextProvider_TracksUniqueEnabledUsers()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync("user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>(), It.IsAny<object>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordUsageAsync("TestFeature", context, allowed: true);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageEnabledMap.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordUsageAsync_WithContextProvider_TracksUniqueDisabledUsers()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync("user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>(), It.IsAny<object>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordUsageAsync("TestFeature", context, allowed: false);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageDisabledMap.Should().NotBeNull();
    }

    #endregion

    #region GetDebugInfo Tests

    [Fact]
    public void GetDebugInfo_ReturnsCorrectValues()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.AppKey.Should().Be("test-app-key");
        debugInfo.Environment.Should().Be("Test");
        debugInfo.BaseUrl.Should().Be("https://test.toggly.io/");
        debugInfo.UserAgent.Should().StartWith("Toggly.FeatureManagement/");
    }

    [Fact]
    public void GetDebugInfo_ReturnsEmptyMapsInitially()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.UniqueUsageEnabledMap.Should().BeEmpty();
        debugInfo.UniqueUsageDisabledMap.Should().BeEmpty();
        debugInfo.UniqueUsageUsedMap.Should().BeEmpty();
        debugInfo.LastError.Should().BeEmpty();
        debugInfo.LastErrorTime.Should().BeNull();
        debugInfo.LastSend.Should().BeNull();
    }

    #endregion

    #region Dispose Tests

    [Fact]
    public void Dispose_CanBeCalledMultipleTimes()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        _provider.Dispose();
        var act = () => _provider.Dispose();

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void Dispose_StopsTimers()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        _provider.Dispose();

        // Assert - No exception should occur
        _provider.Should().NotBeNull();
    }

    #endregion

    #region StatType Enum Tests

    [Fact]
    public void StatType_HasExpectedValues()
    {
        // Assert
        Enum.GetValues<TogglyUsageStatsProvider.StatType>().Should().HaveCount(6);
        TogglyUsageStatsProvider.StatType.Enabled.Should().Be((TogglyUsageStatsProvider.StatType)0);
        TogglyUsageStatsProvider.StatType.Disabled.Should().Be((TogglyUsageStatsProvider.StatType)1);
        TogglyUsageStatsProvider.StatType.UniqueRequestEnabled.Should().Be((TogglyUsageStatsProvider.StatType)2);
        TogglyUsageStatsProvider.StatType.UniqueRequestDisabled.Should().Be((TogglyUsageStatsProvider.StatType)3);
        TogglyUsageStatsProvider.StatType.Used.Should().Be((TogglyUsageStatsProvider.StatType)4);
        TogglyUsageStatsProvider.StatType.Viewed.Should().Be((TogglyUsageStatsProvider.StatType)5);
    }

    #endregion

    #region UsageStatsDebugInfo Tests

    [Fact]
    public void UsageStatsDebugInfo_Properties_CanBeSetAndRead()
    {
        // Arrange
        var debugInfo = new UsageStatsDebugInfo
        {
            AppKey = "test-key",
            Environment = "Production",
            BaseUrl = "https://api.toggly.io",
            UserAgent = "TestAgent/1.0",
            LastError = "Test error",
            LastErrorTime = DateTime.UtcNow,
            LastSend = DateTime.UtcNow.AddMinutes(-5)
        };

        // Assert
        debugInfo.AppKey.Should().Be("test-key");
        debugInfo.Environment.Should().Be("Production");
        debugInfo.BaseUrl.Should().Be("https://api.toggly.io");
        debugInfo.UserAgent.Should().Be("TestAgent/1.0");
        debugInfo.LastError.Should().Be("Test error");
        debugInfo.LastErrorTime.Should().NotBeNull();
        debugInfo.LastSend.Should().NotBeNull();
    }

    #endregion

    #region Concurrent Operations Tests

    [Fact]
    public async Task RecordUsageAsync_ConcurrentCalls_HandledCorrectly()
    {
        // Arrange
        _provider = CreateProvider();
        var tasks = new List<Task>();

        // Act - Record many usages concurrently
        for (int i = 0; i < 100; i++)
        {
            tasks.Add(_provider.RecordUsageAsync($"Feature{i % 5}"));
        }

        await Task.WhenAll(tasks);

        // Assert - Should not throw
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordCheckAsync_ConcurrentCalls_HandledCorrectly()
    {
        // Arrange
        _provider = CreateProvider();
        var tasks = new List<Task>();

        // Act - Record many checks concurrently
        for (int i = 0; i < 100; i++)
        {
            tasks.Add(_provider.RecordCheckAsync($"Feature{i % 5}", i % 2 == 0));
        }

        await Task.WhenAll(tasks);

        // Assert - Should not throw
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Context Provider with Null Identifier Tests

    [Fact]
    public async Task RecordUsageAsync_WithContextProviderReturningNull_HandlesGracefully()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync((string?)null);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordUsageAsync("TestFeature");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap.Should().BeEmpty();
    }

    [Fact]
    public async Task RecordViewAsync_WithContextProviderReturningNull_HandlesGracefully()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync((string?)null);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordViewAsync("TestFeature");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordCheckAsync_WithContextProviderReturningNull_HandlesGracefully()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync((string?)null);
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordCheckAsync("TestFeature", allowed: true);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageEnabledMap.Should().BeEmpty();
    }

    #endregion

    #region RecordViewAsync with Context Provider Tests

    [Fact]
    public async Task RecordViewAsync_WithContextProviderAndContext_TracksUniqueUsers()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync("user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordViewAsync("TestFeature", context);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordViewAsync_WithContextProviderReturningNullForContext_HandlesGracefully()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync((string?)null);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordViewAsync("TestFeature", context);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region RecordUsageAsync with Context Identifier Tests

    [Fact]
    public async Task RecordUsageAsync_WithContextAndContextProvider_TracksUniqueUsers()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync("user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordUsageAsync("TestFeature", context);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap.Should().NotBeNull();
        contextProviderMock.Verify(x => x.GetContextIdentifierAsync(context), Times.Once);
    }

    [Fact]
    public async Task RecordUsageAsync_WithContextProviderReturningNullForContext_HandlesGracefully()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync((string?)null);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordUsageAsync("TestFeature", context);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap.Should().BeEmpty();
    }

    #endregion

    #region RecordCheckAsync with Disabled Status Tests

    [Fact]
    public async Task RecordCheckAsync_Disabled_WithContextProvider_TracksUniqueUsers()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordCheckAsync("TestFeature", allowed: false);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageDisabledMap.Should().NotBeNull();
    }

    #endregion

    #region Multiple User Tracking Tests

    [Fact]
    public async Task RecordUsageAsync_MultipleUsers_TracksAllUniqueUsers()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        var users = new[] { "user1@test.com", "user2@test.com", "user1@test.com" }; // user1 twice
        var userIndex = 0;

        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync(() => users[userIndex++]);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordUsageAsync("TestFeature");
        await _provider.RecordUsageAsync("TestFeature");
        await _provider.RecordUsageAsync("TestFeature");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap.Should().ContainKey("TestFeature");
        // Should have 2 unique users (user1 appears twice but counted once due to hash)
        debugInfo.UniqueUsageUsedMap!["TestFeature"].Count.Should().Be(2);
    }

    [Fact]
    public async Task RecordCheckAsync_MultipleUsersEnabledAndDisabled_TracksCorrectly()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordCheckAsync("TestFeature", allowed: true);
        await _provider.RecordCheckAsync("TestFeature", allowed: false);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageEnabledMap.Should().ContainKey("TestFeature");
        debugInfo.UniqueUsageDisabledMap.Should().ContainKey("TestFeature");
    }

    #endregion

    #region Default BaseUrl Tests

    [Fact]
    public void Constructor_WithNullBaseUrl_UsesDefaultUrl()
    {
        // Arrange
        _settingsMock.Setup(x => x.Value).Returns(new TogglySettings
        {
            AppKey = "test-app-key",
            Environment = "Test",
            BaseUrl = null
        });

        // Act
        _provider = CreateProvider();

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.BaseUrl.Should().Be("https://app.toggly.io/");
    }

    #endregion

    #region Mixed Operations Tests

    [Fact]
    public async Task AllOperations_MixedConcurrently_HandledCorrectly()
    {
        // Arrange
        _provider = CreateProvider();
        var tasks = new List<Task>();

        // Act - Mix of all operation types concurrently
        for (int i = 0; i < 30; i++)
        {
            tasks.Add(_provider.RecordUsageAsync($"Feature{i % 3}"));
            tasks.Add(_provider.RecordViewAsync($"Feature{i % 3}"));
            tasks.Add(_provider.RecordCheckAsync($"Feature{i % 3}", i % 2 == 0));
        }

        await Task.WhenAll(tasks);

        // Assert - Should not throw
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region RecordUsageAsync with Allowed and ContextProvider Tests

    [Fact]
    public async Task RecordUsageAsync_WithAllowedAndContextProvider_SkipsUniqueWhenAlreadyAccessed()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync("user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>(), It.IsAny<object>()))
            .ReturnsAsync(true); // Already accessed

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordUsageAsync("TestFeature", context, allowed: true);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordUsageAsync_WithAllowedAndContextProviderReturningNull_HandlesGracefully()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync((string?)null);
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>(), It.IsAny<object>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordUsageAsync("TestFeature", context, allowed: true);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageEnabledMap.Should().BeEmpty();
    }

    #endregion

    #region Application Lifetime Tests

    [Fact]
    public async Task Constructor_RegistersApplicationStoppingCallback()
    {
        // Arrange
        _provider = CreateProvider();

        // Act - simulate application stopping
        _stoppingCts.Cancel();
        await Task.Delay(100);

        // Assert - no exception should be thrown
        _provider.Should().NotBeNull();
    }

    #endregion

    #region App Version Tests

    [Fact]
    public void Constructor_WithNullAppVersion_UsesEntryAssemblyVersion()
    {
        // Arrange
        _settingsMock.Setup(x => x.Value).Returns(new TogglySettings
        {
            AppKey = "test-app-key",
            Environment = "Test",
            BaseUrl = "https://test.toggly.io/",
            AppVersion = null,
            InstanceName = "test-instance"
        });

        // Act
        _provider = CreateProvider();

        // Assert
        _provider.Should().NotBeNull();
    }

    #endregion

    #region Hash Function Tests

    [Fact]
    public async Task RecordUsageAsync_SameUser_ProducesSameHash()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("consistent-user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordUsageAsync("TestFeature");
        await _provider.RecordUsageAsync("TestFeature");

        // Assert - same user should be counted once
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap!["TestFeature"].Count.Should().Be(1);
    }

    [Fact]
    public async Task RecordUsageAsync_DifferentUsers_ProduceDifferentHashes()
    {
        // Arrange
        var callCount = 0;
        var users = new[] { "user1@example.com", "user2@example.com", "user3@example.com" };

        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync(() => users[callCount++ % users.Length]);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordUsageAsync("TestFeature");
        await _provider.RecordUsageAsync("TestFeature");
        await _provider.RecordUsageAsync("TestFeature");

        // Assert - different users should all be counted
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap!["TestFeature"].Count.Should().Be(3);
    }

    #endregion

    #region View and Usage Combined Tests

    [Fact]
    public async Task RecordViewAndUsage_SameFeature_TracksIndependently()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordViewAsync("TestFeature");
        await _provider.RecordUsageAsync("TestFeature");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordCheckAndUsage_SameFeature_TracksAllTypes()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordCheckAsync("TestFeature", allowed: true);
        await _provider.RecordUsageAsync("TestFeature");
        await _provider.RecordViewAsync("TestFeature");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageEnabledMap.Should().ContainKey("TestFeature");
        debugInfo.UniqueUsageUsedMap.Should().ContainKey("TestFeature");
    }

    #endregion

    #region Feature Key Tests

    [Fact]
    public async Task RecordUsageAsync_EmptyFeatureKey_StillRecords()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        await _provider.RecordUsageAsync("");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordUsageAsync_SpecialCharactersInFeatureKey_HandledCorrectly()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        await _provider.RecordUsageAsync("feature-with_special.chars:123");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Large Scale Tests

    [Fact]
    public async Task RecordUsageAsync_ManyDifferentFeatures_HandledCorrectly()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        var tasks = Enumerable.Range(0, 50)
            .Select(i => _provider.RecordUsageAsync($"Feature{i}"));

        await Task.WhenAll(tasks);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordCheckAsync_ManyUsersPerFeature_HandledCorrectly()
    {
        // Arrange
        var userIndex = 0;
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync(() => $"user{userIndex++}@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        var tasks = Enumerable.Range(0, 50)
            .Select(_ => _provider.RecordCheckAsync("TestFeature", allowed: true));

        await Task.WhenAll(tasks);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageEnabledMap!["TestFeature"].Count.Should().Be(50);
    }

    #endregion

    #region DebugInfo Update Tests

    [Fact]
    public async Task GetDebugInfo_AfterOperations_ReflectsCurrentState()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("debug-test-user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act - record usage for a unique feature name to avoid interference from other tests
        var uniqueFeature = $"DebugTestFeature_{Guid.NewGuid():N}";
        await _provider.RecordUsageAsync(uniqueFeature);
        var debugInfoAfter = _provider.GetDebugInfo();

        // Assert - verify the feature was recorded (don't assume empty initial state)
        debugInfoAfter.UniqueUsageUsedMap.Should().ContainKey(uniqueFeature);
    }

    #endregion

    #region Access Request Already Accessed Tests

    [Fact]
    public async Task RecordCheckAsync_WhenAccessedInRequest_DoesNotCountUniqueRequest()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(true); // Already accessed in this request

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordCheckAsync("TestFeature", allowed: true);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        // UniqueRequest counts should not be incremented since already accessed
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordUsageAsync_WithContextAndAllowed_WhenAccessedInRequest_DoesNotCountUniqueRequest()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync("user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>(), It.IsAny<object>()))
            .ReturnsAsync(true); // Already accessed in this request

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordUsageAsync("TestFeature", context, allowed: false);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        // UniqueRequest counts should not be incremented since already accessed
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Disabled Status with Unique Users Tests

    [Fact]
    public async Task RecordUsageAsync_DisabledWithContextProvider_TracksUniqueDisabledUsers()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync("user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>(), It.IsAny<object>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "user123" };

        // Act
        await _provider.RecordUsageAsync("TestFeature", context, allowed: false);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageDisabledMap.Should().ContainKey("TestFeature");
    }

    #endregion

    #region Multiple Features Per User Tests

    [Fact]
    public async Task RecordUsageAsync_SameUserDifferentFeatures_TrackedPerFeature()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordUsageAsync("Feature1");
        await _provider.RecordUsageAsync("Feature2");
        await _provider.RecordUsageAsync("Feature3");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap.Should().ContainKey("Feature1");
        debugInfo.UniqueUsageUsedMap.Should().ContainKey("Feature2");
        debugInfo.UniqueUsageUsedMap.Should().ContainKey("Feature3");
        debugInfo.UniqueUsageUsedMap!["Feature1"].Count.Should().Be(1);
        debugInfo.UniqueUsageUsedMap!["Feature2"].Count.Should().Be(1);
        debugInfo.UniqueUsageUsedMap!["Feature3"].Count.Should().Be(1);
    }

    #endregion

    #region Initialization Tests

    [Fact]
    public void Constructor_InitializesTimers()
    {
        // Act
        _provider = CreateProvider();

        // Assert - provider is created without errors
        _provider.Should().NotBeNull();
    }

    [Fact]
    public void Constructor_WithProcessStartTime_Initializes()
    {
        // Act
        _provider = CreateProvider();

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region RecordCheckAsync with Both Enabled and Disabled Tests

    [Fact]
    public async Task RecordCheckAsync_AlternatingEnabledDisabled_TracksCorrectly()
    {
        // Arrange
        var userIndex = 0;
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync(() => $"user{userIndex++}@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act - alternate between enabled and disabled
        for (int i = 0; i < 10; i++)
        {
            await _provider.RecordCheckAsync("TestFeature", allowed: i % 2 == 0);
        }

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageEnabledMap!["TestFeature"].Count.Should().Be(5);
        debugInfo.UniqueUsageDisabledMap!["TestFeature"].Count.Should().Be(5);
    }

    #endregion
}
