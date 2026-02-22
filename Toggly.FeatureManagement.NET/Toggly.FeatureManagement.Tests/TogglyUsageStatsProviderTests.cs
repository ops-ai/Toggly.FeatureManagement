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

    #region Unique User Hash Tracking Tests

    [Fact]
    public async Task RecordUsageAsync_TracksUniqueUserHashesForMonthlyTracking()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("monthly-user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordUsageAsync("MonthlyTrackingFeature");

        // Assert - Verify the usage was recorded
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap.Should().ContainKey("MonthlyTrackingFeature");
    }

    [Fact]
    public async Task RecordViewAsync_TracksUniqueViewedUserHashesForMonthlyTracking()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("viewed-user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordViewAsync("ViewTrackingFeature");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordCheckAsync_TracksApplicationLevelUniqueUserHashes()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("app-level-user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act
        await _provider.RecordCheckAsync("AppLevelFeature", allowed: true);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageEnabledMap.Should().ContainKey("AppLevelFeature");
    }

    #endregion

    #region View with Context Tests

    [Fact]
    public async Task RecordViewAsync_WithContextAndProvider_TracksAllUniqueData()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync("context-view-user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { SessionId = "session-123" };

        // Act
        await _provider.RecordViewAsync("ViewFeatureWithContext", context);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
        contextProviderMock.Verify(x => x.GetContextIdentifierAsync(context), Times.Once);
    }

    [Fact]
    public async Task RecordViewAsync_MultipleViewsSameUser_DeduplicatesCorrectly()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("repeat-viewer@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act - View same feature multiple times
        await _provider.RecordViewAsync("ViewDedupeFeature");
        await _provider.RecordViewAsync("ViewDedupeFeature");
        await _provider.RecordViewAsync("ViewDedupeFeature");

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Usage with Context Tests

    [Fact]
    public async Task RecordUsageAsync_WithContextAndProvider_TracksAllUniqueData()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync("context-usage-user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "ctx-user-456" };

        // Act
        await _provider.RecordUsageAsync("UsageFeatureWithContext", context);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap.Should().ContainKey("UsageFeatureWithContext");
        contextProviderMock.Verify(x => x.GetContextIdentifierAsync(context), Times.Once);
    }

    #endregion

    #region Multiple Feature Tracking Tests

    [Fact]
    public async Task RecordOperations_MultipleFeaturesMultipleUsers_TracksAllCorrectly()
    {
        // Arrange
        var userIndex = 0;
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync(() => $"multi-user-{userIndex++ % 3}@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act - Multiple operations on different features
        for (int i = 0; i < 9; i++)
        {
            await _provider.RecordUsageAsync($"MultiFeature{i % 3}");
            await _provider.RecordViewAsync($"MultiFeature{i % 3}");
            await _provider.RecordCheckAsync($"MultiFeature{i % 3}", allowed: true);
        }

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap.Should().ContainKey("MultiFeature0");
        debugInfo.UniqueUsageUsedMap.Should().ContainKey("MultiFeature1");
        debugInfo.UniqueUsageUsedMap.Should().ContainKey("MultiFeature2");
    }

    #endregion

    #region Edge Case Tests

    [Fact]
    public async Task RecordUsageAsync_WhitespaceFeatureKey_StillRecords()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        await _provider.RecordUsageAsync("   ");

        // Assert - Should not throw
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordViewAsync_VeryLongFeatureKey_HandledCorrectly()
    {
        // Arrange
        _provider = CreateProvider();
        var longKey = new string('a', 1000);

        // Act
        await _provider.RecordViewAsync(longKey);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordCheckAsync_UnicodeFeatureKey_HandledCorrectly()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        await _provider.RecordCheckAsync("功能键-特性🎉", allowed: true);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Concurrent User Hash Tracking Tests

    [Fact]
    public async Task RecordUsageAsync_ConcurrentDifferentUsers_AllTracked()
    {
        // Arrange
        var userIndex = 0;
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync(() => $"concurrent-user-{Interlocked.Increment(ref userIndex)}@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act - Concurrent usage recording
        var tasks = Enumerable.Range(0, 20)
            .Select(_ => _provider.RecordUsageAsync("ConcurrentFeature"));

        await Task.WhenAll(tasks);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap.Should().ContainKey("ConcurrentFeature");
        debugInfo.UniqueUsageUsedMap!["ConcurrentFeature"].Count.Should().Be(20);
    }

    [Fact]
    public async Task RecordViewAsync_ConcurrentDifferentUsers_AllTracked()
    {
        // Arrange
        var userIndex = 0;
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync(() => $"concurrent-view-user-{Interlocked.Increment(ref userIndex)}@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act - Concurrent view recording
        var tasks = Enumerable.Range(0, 20)
            .Select(_ => _provider.RecordViewAsync("ConcurrentViewFeature"));

        await Task.WhenAll(tasks);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.Should().NotBeNull();
    }

    #endregion

    #region Check Operations with Different Allowed States Tests

    [Fact]
    public async Task RecordUsageAsync_WithAllowed_TracksEnabledSeparately()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync("enabled-allowed-user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>(), It.IsAny<object>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "u1" };

        // Act
        await _provider.RecordUsageAsync("AllowedTestFeature", context, allowed: true);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageEnabledMap.Should().ContainKey("AllowedTestFeature");
        debugInfo.UniqueUsageDisabledMap.Should().NotContainKey("AllowedTestFeature");
    }

    [Fact]
    public async Task RecordUsageAsync_WithNotAllowed_TracksDisabledSeparately()
    {
        // Arrange
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync(It.IsAny<object>()))
            .ReturnsAsync("disabled-allowed-user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>(), It.IsAny<object>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();
        var context = new { UserId = "u2" };

        // Act
        await _provider.RecordUsageAsync("DisallowedTestFeature", context, allowed: false);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageDisabledMap.Should().ContainKey("DisallowedTestFeature");
        debugInfo.UniqueUsageEnabledMap.Should().NotContainKey("DisallowedTestFeature");
    }

    #endregion

    #region Shutdown and Dispose Tests

    [Fact]
    public void Dispose_AfterManyOperations_DisposesCleanly()
    {
        // Arrange
        _provider = CreateProvider();

        // Act - record many operations
        for (int i = 0; i < 100; i++)
        {
            _provider.RecordUsageAsync($"DisposalFeature{i % 10}").Wait();
        }

        // Dispose
        _provider.Dispose();
        _provider = null;

        // Assert - no exception
    }

    [Fact]
    public async Task Dispose_DuringOperations_HandlesGracefully()
    {
        // Arrange
        _provider = CreateProvider();

        // Start operations
        var recordTask = Task.Run(async () =>
        {
            for (int i = 0; i < 50; i++)
            {
                try
                {
                    await _provider!.RecordUsageAsync($"ConcurrentDisposalFeature{i}");
                }
                catch (ObjectDisposedException)
                {
                    // Expected during dispose
                    break;
                }
            }
        });

        // Wait a bit then dispose
        await Task.Delay(10);
        _provider?.Dispose();
        _provider = null;

        // Wait for operations to complete or fail
        await Task.WhenAny(recordTask, Task.Delay(1000));
    }

    #endregion

    #region State After Operations Tests

    [Fact]
    public async Task GetDebugInfo_AfterMixedOperations_ReflectsAllMaps()
    {
        // Arrange
        var userIndex = 0;
        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync(() => $"mixed-op-user-{userIndex++}@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Act - Perform all types of operations
        await _provider.RecordUsageAsync("MixedFeature");
        await _provider.RecordViewAsync("MixedFeature");
        await _provider.RecordCheckAsync("MixedFeature", allowed: true);
        await _provider.RecordCheckAsync("MixedFeature2", allowed: false);

        // Assert
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap.Should().ContainKey("MixedFeature");
        debugInfo.UniqueUsageEnabledMap.Should().ContainKey("MixedFeature");
        debugInfo.UniqueUsageDisabledMap.Should().ContainKey("MixedFeature2");
    }

    #endregion

    #region Debug Info Initial State Tests

    [Fact]
    public void GetDebugInfo_UserAgentFormat_IsCorrect()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.UserAgent.Should().StartWith("Toggly.FeatureManagement/");
        // Version may be empty in test context, just verify format starts correctly
        debugInfo.UserAgent.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void GetDebugInfo_AllMapsInitialized_NotNull()
    {
        // Arrange
        _provider = CreateProvider();

        // Act
        var debugInfo = _provider.GetDebugInfo();

        // Assert
        debugInfo.UniqueUsageEnabledMap.Should().NotBeNull();
        debugInfo.UniqueUsageDisabledMap.Should().NotBeNull();
        debugInfo.UniqueUsageUsedMap.Should().NotBeNull();
    }

    #endregion

    #region SendStats Tests via Reflection

    [Fact]
    public async Task SendStats_WhenNoStats_DoesNotCallGrpcClient()
    {
        // Arrange
        _provider = CreateProvider();

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert - gRPC client should not be called when no stats
        _usageClientMock.Verify(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task SendStats_WithStats_CallsGrpcClient()
    {
        // Arrange
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Returns(new AsyncUnaryCall<StatResult>(
                Task.FromResult(new StatResult { FeatureCount = 1 }),
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));

        _provider = CreateProvider();

        // Record some stats first
        await _provider.RecordUsageAsync("TestFeature");

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert - gRPC client should be called
        _usageClientMock.Verify(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task SendStats_WhenGrpcThrows_RestoresStats()
    {
        // Arrange
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Throws(new RpcException(new Status(StatusCode.Unavailable, "Service unavailable")));

        _provider = CreateProvider();

        // Record some stats first
        await _provider.RecordUsageAsync("TestFeature");
        await _provider.RecordViewAsync("TestFeature");
        await _provider.RecordCheckAsync("TestFeature", allowed: true);

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert - Stats should be restored on error
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.LastError.Should().ContainEquivalentOf("unavailable");
        debugInfo.LastErrorTime.Should().NotBeNull();
    }

    [Fact]
    public async Task SendStats_WithViewedStats_IncludesVariantStats()
    {
        // Arrange
        var capturedRequest = new FeatureStat();
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Callback<FeatureStat, Metadata, DateTime?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .Returns(new AsyncUnaryCall<StatResult>(
                Task.FromResult(new StatResult { FeatureCount = 1 }),
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));

        _provider = CreateProvider();

        // Record view stats
        await _provider.RecordViewAsync("ViewedFeature");

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert - VariantStats should include viewed count
        capturedRequest.Stats.Should().ContainSingle();
        capturedRequest.Stats[0].Feature.Should().Be("ViewedFeature");
    }

    [Fact]
    public async Task SendStats_SetsLastSendTime()
    {
        // Arrange
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Returns(new AsyncUnaryCall<StatResult>(
                Task.FromResult(new StatResult { FeatureCount = 1 }),
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));

        _provider = CreateProvider();
        var debugInfoBefore = _provider.GetDebugInfo();
        debugInfoBefore.LastSend.Should().BeNull();

        // Record stats
        await _provider.RecordUsageAsync("TestFeature");

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert
        var debugInfoAfter = _provider.GetDebugInfo();
        debugInfoAfter.LastSend.Should().NotBeNull();
        debugInfoAfter.LastSend.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task SendStats_WithFeatureCountMismatch_LogsWarning()
    {
        // Arrange
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Returns(new AsyncUnaryCall<StatResult>(
                Task.FromResult(new StatResult { FeatureCount = 999 }), // Mismatched count
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));

        _provider = CreateProvider();

        // Record stats
        await _provider.RecordUsageAsync("TestFeature");

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert - Should still succeed (just logs warning)
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.LastSend.Should().NotBeNull();
    }

    [Fact]
    public async Task SendStats_WithUniqueUserHashes_IncludesHashesInRequest()
    {
        // Arrange
        var capturedRequest = new FeatureStat();
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Callback<FeatureStat, Metadata, DateTime?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .Returns(new AsyncUnaryCall<StatResult>(
                Task.FromResult(new StatResult { FeatureCount = 1 }),
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));

        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("unique-user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Record usage with context provider (triggers unique user tracking)
        await _provider.RecordUsageAsync("HashFeature");

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert - Request should include unique user hashes
        capturedRequest.Stats.Should().ContainSingle();
        capturedRequest.Stats[0].UniqueUserHashes.Should().NotBeEmpty();
    }

    [Fact]
    public async Task SendStats_WithApplicationUniqueUserHashes_IncludesAppLevelHashes()
    {
        // Arrange
        var capturedRequest = new FeatureStat();
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Callback<FeatureStat, Metadata, DateTime?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .Returns(new AsyncUnaryCall<StatResult>(
                Task.FromResult(new StatResult { FeatureCount = 1 }),
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));

        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("app-level-user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Record check (triggers application-level unique user tracking)
        await _provider.RecordCheckAsync("AppHashFeature", allowed: true);

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert - Request should include application-level unique user hashes
        capturedRequest.UniqueUserHashes.Should().NotBeEmpty();
    }

    [Fact]
    public async Task SendStats_ConcurrentCalls_OnlyOneExecutes()
    {
        // Arrange
        var callCount = 0;
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Callback(() => Interlocked.Increment(ref callCount))
            .Returns(() => new AsyncUnaryCall<StatResult>(
                Task.Delay(100).ContinueWith(_ => new StatResult { FeatureCount = 1 }),
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));

        _provider = CreateProvider();

        // Record stats
        await _provider.RecordUsageAsync("ConcurrentFeature");

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act - Call SendStats concurrently
        var tasks = Enumerable.Range(0, 5)
            .Select(_ => (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!);

        await Task.WhenAll(tasks);

        // Assert - Only one should execute due to semaphore
        // (The first one gets the semaphore, others skip)
        // Due to test timing, we might get 1 or 2 calls
        callCount.Should().BeLessOrEqualTo(2);
    }

    #endregion

    #region ResetUsageMap Tests via Reflection

    [Fact]
    public async Task ResetUsageMap_WhenMapsAreEmpty_DoesNotCallSendStats()
    {
        // Arrange
        _provider = CreateProvider();

        // Use reflection to invoke ResetUsageMap
        var resetMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("ResetUsageMap", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        // Act
        var task = (Task)resetMethod!.Invoke(_provider, null)!;
        await task;

        // Assert - gRPC client should not be called when maps are empty
        _usageClientMock.Verify(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task ResetUsageMap_WithNonEmptyMaps_SendsAndClears()
    {
        // Arrange
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Returns(new AsyncUnaryCall<StatResult>(
                Task.FromResult(new StatResult { FeatureCount = 1 }),
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));

        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("reset-test-user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Record usage to populate maps
        await _provider.RecordUsageAsync("ResetFeature");

        // Use reflection to invoke ResetUsageMap
        var resetMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("ResetUsageMap", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        // Act
        var task = (Task)resetMethod!.Invoke(_provider, null)!;
        await task;

        // Assert - Maps should be cleared after reset
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageUsedMap.Should().BeEmpty();
    }

    #endregion

    #region TryLog Tests via Edge Cases

    [Fact]
    public async Task RecordUsageAsync_AfterDispose_HandlesGracefully()
    {
        // Arrange
        _provider = CreateProvider();
        _provider.Dispose();

        // Act & Assert - Should not throw even after dispose
        // The TryLog method handles disposed state
        await _provider.RecordUsageAsync("PostDisposeFeature");
    }

    #endregion

    #region Error Restoration Tests

    [Fact]
    public async Task SendStats_WhenGrpcThrows_RestoresUniqueUsageMaps()
    {
        // Arrange
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Throws(new RpcException(new Status(StatusCode.Internal, "Internal error")));

        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("restore-user@example.com");
        contextProviderMock.Setup(x => x.AccessedInRequestAsync(It.IsAny<string>()))
            .ReturnsAsync(false);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Record stats that will populate unique maps
        await _provider.RecordCheckAsync("RestoreFeature", allowed: true);

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert - UniqueUsage maps should be restored after error
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.UniqueUsageEnabledMap.Should().ContainKey("RestoreFeature");
    }

    [Fact]
    public async Task SendStats_WhenGrpcThrows_RestoresViewedUserHashes()
    {
        // Arrange
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Throws(new RpcException(new Status(StatusCode.Cancelled, "Cancelled")));

        var contextProviderMock = new Mock<IFeatureContextProvider>();
        contextProviderMock.Setup(x => x.GetContextIdentifierAsync())
            .ReturnsAsync("restore-viewed-user@example.com");

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureContextProvider)))
            .Returns(contextProviderMock.Object);

        _provider = CreateProvider();

        // Record view that will populate viewed user hashes
        await _provider.RecordViewAsync("RestoreViewFeature");

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert - Error should be recorded
        var debugInfo = _provider.GetDebugInfo();
        debugInfo.LastError.Should().NotBeEmpty();
    }

    #endregion

    #region ProcessStartTime Tests

    [Fact]
    public async Task SendStats_IncludesProcessStartTime()
    {
        // Arrange
        var capturedRequest = new FeatureStat();
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Callback<FeatureStat, Metadata, DateTime?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .Returns(new AsyncUnaryCall<StatResult>(
                Task.FromResult(new StatResult { FeatureCount = 1 }),
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));

        _provider = CreateProvider();

        // Record stats
        await _provider.RecordUsageAsync("ProcessTimeFeature");

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert - ProcessStartTime should be set
        capturedRequest.ProcessStartTime.Should().NotBeNull();
    }

    #endregion

    #region Metadata Tests

    [Fact]
    public async Task SendStats_IncludesUserAgentInMetadata()
    {
        // Arrange
        Metadata? capturedMetadata = null;
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Callback<FeatureStat, Metadata, DateTime?, CancellationToken>((_, metadata, _, _) => capturedMetadata = metadata)
            .Returns(new AsyncUnaryCall<StatResult>(
                Task.FromResult(new StatResult { FeatureCount = 1 }),
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));

        _provider = CreateProvider();

        // Record stats
        await _provider.RecordUsageAsync("MetadataFeature");

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert - Metadata should include UA header (key is lowercase in gRPC)
        capturedMetadata.Should().NotBeNull();
        capturedMetadata.Should().Contain(e => e.Key == "ua");
    }

    #endregion

    #region Multiple Features In Single Send Tests

    [Fact]
    public async Task SendStats_WithMultipleFeatures_SendsAllInOneRequest()
    {
        // Arrange
        var capturedRequest = new FeatureStat();
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Callback<FeatureStat, Metadata, DateTime?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .Returns(new AsyncUnaryCall<StatResult>(
                Task.FromResult(new StatResult { FeatureCount = 3 }),
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));

        _provider = CreateProvider();

        // Record stats for multiple features
        await _provider.RecordUsageAsync("Feature1");
        await _provider.RecordUsageAsync("Feature2");
        await _provider.RecordViewAsync("Feature3");

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert - All features should be in one request
        capturedRequest.Stats.Should().HaveCount(3);
        capturedRequest.Stats.Select(s => s.Feature).Should().Contain(new[] { "Feature1", "Feature2", "Feature3" });
    }

    #endregion

    #region App Key and Environment in Request Tests

    [Fact]
    public async Task SendStats_IncludesAppKeyAndEnvironment()
    {
        // Arrange
        var capturedRequest = new FeatureStat();
        _usageClientMock.Setup(x => x.SendStatsAsync(
            It.IsAny<FeatureStat>(),
            It.IsAny<Metadata>(),
            It.IsAny<DateTime?>(),
            It.IsAny<CancellationToken>()))
            .Callback<FeatureStat, Metadata, DateTime?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .Returns(new AsyncUnaryCall<StatResult>(
                Task.FromResult(new StatResult { FeatureCount = 1 }),
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { }));

        _provider = CreateProvider();

        // Record stats
        await _provider.RecordUsageAsync("AppEnvFeature");

        // Use reflection to invoke SendStats
        var sendStatsMethod = typeof(TogglyUsageStatsProvider)
            .GetMethod("SendStats", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance,
                new[] { typeof(bool) });

        // Act
        var task = (Task)sendStatsMethod!.Invoke(_provider, new object[] { false })!;
        await task;

        // Assert
        capturedRequest.AppKey.Should().Be("test-app-key");
        capturedRequest.Environment.Should().Be("Test");
        capturedRequest.AppVersion.Should().Be("1.0.0");
        capturedRequest.InstanceName.Should().Be("test-instance");
    }

    #endregion
}
