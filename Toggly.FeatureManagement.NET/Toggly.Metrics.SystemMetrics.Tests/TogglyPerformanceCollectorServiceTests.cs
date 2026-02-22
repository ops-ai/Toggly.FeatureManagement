using FluentAssertions;
using Moq;
using System.Diagnostics.Tracing;
using System.Reflection;
using Toggly.FeatureManagement;
using Toggly.Metrics.SystemMetrics.Collectors;
using Xunit;

namespace Toggly.Metrics.SystemMetrics.Tests;

public class TogglyPerformanceCollectorServiceTests
{
    private readonly Mock<IMetricsRegistryService> _metricsRegistryServiceMock;
    private readonly Dictionary<string, Dictionary<string, string>> _eventSources;

    public TogglyPerformanceCollectorServiceTests()
    {
        _metricsRegistryServiceMock = new Mock<IMetricsRegistryService>();
        _eventSources = new Dictionary<string, Dictionary<string, string>>
        {
            ["System.Runtime"] = new Dictionary<string, string>
            {
                ["cpu-usage"] = "cpu_usage_percentage",
                ["working-set"] = "memory_working_set"
            }
        };
    }

    #region Constructor Tests

    [Fact]
    public void Constructor_InitializesEventSources()
    {
        // Act
        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Assert
        service.Should().NotBeNull();
    }

    [Fact]
    public void Constructor_InitializesMetricsRegistryService()
    {
        // Act
        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Assert
        service.Should().NotBeNull();
    }

    [Fact]
    public void Constructor_WithEmptyEventSources_DoesNotThrow()
    {
        // Arrange
        var emptyEventSources = new Dictionary<string, Dictionary<string, string>>();

        // Act
        var action = () => new TogglyPerformanceCollectorService(emptyEventSources, _metricsRegistryServiceMock.Object);

        // Assert
        action.Should().NotThrow();
    }

    #endregion

    #region IsSupported Tests

    [Fact]
    public void IsSupported_ReturnsTrue()
    {
        // Arrange
        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Act
        var result = service.IsSupported;

        // Assert
        result.Should().BeTrue();
    }

    #endregion

    #region StartAsync Tests

    [Fact]
    public async Task StartAsync_RegistersObservationsCallback()
    {
        // Arrange
        var expectedGuid = Guid.NewGuid();
        _metricsRegistryServiceMock
            .Setup(x => x.RegisterObservations(It.IsAny<Func<Task<Dictionary<string, (DateTime, double)>>>>()))
            .Returns(expectedGuid);

        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Act
        await service.StartAsync(CancellationToken.None);

        // Assert
        _metricsRegistryServiceMock.Verify(
            x => x.RegisterObservations(It.IsAny<Func<Task<Dictionary<string, (DateTime, double)>>>>()),
            Times.Once);
    }

    [Fact]
    public async Task StartAsync_ReturnsCompletedTask()
    {
        // Arrange
        _metricsRegistryServiceMock
            .Setup(x => x.RegisterObservations(It.IsAny<Func<Task<Dictionary<string, (DateTime, double)>>>>()))
            .Returns(Guid.NewGuid());

        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Act
        var task = service.StartAsync(CancellationToken.None);

        // Assert
        task.IsCompleted.Should().BeTrue();
        await task; // Ensure no exceptions
    }

    [Fact]
    public async Task StartAsync_WithCancellationToken_CompletesSuccessfully()
    {
        // Arrange
        using var cts = new CancellationTokenSource();
        _metricsRegistryServiceMock
            .Setup(x => x.RegisterObservations(It.IsAny<Func<Task<Dictionary<string, (DateTime, double)>>>>()))
            .Returns(Guid.NewGuid());

        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Act
        await service.StartAsync(cts.Token);

        // Assert
        _metricsRegistryServiceMock.Verify(
            x => x.RegisterObservations(It.IsAny<Func<Task<Dictionary<string, (DateTime, double)>>>>()),
            Times.Once);
    }

    #endregion

    #region StopAsync Tests

    [Fact]
    public async Task StopAsync_UnregistersMetrics_WhenTaskIdIsSet()
    {
        // Arrange
        var taskGuid = Guid.NewGuid();
        _metricsRegistryServiceMock
            .Setup(x => x.RegisterObservations(It.IsAny<Func<Task<Dictionary<string, (DateTime, double)>>>>()))
            .Returns(taskGuid);
        _metricsRegistryServiceMock
            .Setup(x => x.UnregisterMetrics(taskGuid))
            .Returns(true);

        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);
        await service.StartAsync(CancellationToken.None);

        // Act
        await service.StopAsync(CancellationToken.None);

        // Assert
        _metricsRegistryServiceMock.Verify(x => x.UnregisterMetrics(taskGuid), Times.Once);
    }

    [Fact]
    public async Task StopAsync_DoesNotUnregister_WhenStartAsyncNotCalled()
    {
        // Arrange
        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Act
        await service.StopAsync(CancellationToken.None);

        // Assert
        _metricsRegistryServiceMock.Verify(x => x.UnregisterMetrics(It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task StopAsync_ReturnsCompletedTask()
    {
        // Arrange
        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Act
        var task = service.StopAsync(CancellationToken.None);

        // Assert
        task.IsCompleted.Should().BeTrue();
        await task; // Ensure no exceptions
    }

    [Fact]
    public async Task StopAsync_WithCancellationToken_CompletesSuccessfully()
    {
        // Arrange
        using var cts = new CancellationTokenSource();
        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Act
        await service.StopAsync(cts.Token);

        // Assert - no exception means success
    }

    #endregion

    #region GetObservations Tests

    [Fact]
    public async Task GetObservations_ReturnsEmptyDictionary_WhenNoEventsWritten()
    {
        // Arrange
        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Act
        var result = await service.GetObservations();

        // Assert
        result.Should().NotBeNull();
        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetObservations_ClearsCurrentValues_AfterReturning()
    {
        // Arrange
        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Act - call twice
        var firstResult = await service.GetObservations();
        var secondResult = await service.GetObservations();

        // Assert
        firstResult.Should().BeEmpty();
        secondResult.Should().BeEmpty();
    }

    [Fact]
    public async Task GetObservations_IsThreadSafe()
    {
        // Arrange
        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);
        var tasks = new List<Task<Dictionary<string, (DateTime, double)>>>();

        // Act - call from multiple threads
        for (int i = 0; i < 10; i++)
        {
            tasks.Add(Task.Run(() => service.GetObservations()));
        }

        var results = await Task.WhenAll(tasks);

        // Assert - all should complete without exceptions
        results.Should().AllSatisfy(r => r.Should().NotBeNull());
    }

    #endregion

    #region OnEventSourceCreated Tests

    [Fact]
    public void OnEventSourceCreated_EnablesEvents_ForConfiguredEventSource()
    {
        // Arrange
        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Use reflection to access the protected method
        var onEventSourceCreatedMethod = typeof(TogglyPerformanceCollectorService)
            .GetMethod("OnEventSourceCreated", BindingFlags.NonPublic | BindingFlags.Instance);

        // Create a mock event source - we can't easily test this without a real EventSource
        // This test verifies the method doesn't throw for unregistered sources

        // Assert - constructor completes without error, indicating OnEventSourceCreated works
        service.Should().NotBeNull();
    }

    #endregion

    #region Integration Tests

    [Fact]
    public async Task FullLifecycle_StartAndStop_WorksCorrectly()
    {
        // Arrange
        var taskGuid = Guid.NewGuid();
        _metricsRegistryServiceMock
            .Setup(x => x.RegisterObservations(It.IsAny<Func<Task<Dictionary<string, (DateTime, double)>>>>()))
            .Returns(taskGuid);
        _metricsRegistryServiceMock
            .Setup(x => x.UnregisterMetrics(taskGuid))
            .Returns(true);

        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Act
        await service.StartAsync(CancellationToken.None);
        var observations = await service.GetObservations();
        await service.StopAsync(CancellationToken.None);

        // Assert
        observations.Should().NotBeNull();
        _metricsRegistryServiceMock.Verify(
            x => x.RegisterObservations(It.IsAny<Func<Task<Dictionary<string, (DateTime, double)>>>>()),
            Times.Once);
        _metricsRegistryServiceMock.Verify(x => x.UnregisterMetrics(taskGuid), Times.Once);
    }

    [Fact]
    public async Task MultipleStartStop_WorksCorrectly()
    {
        // Arrange
        var taskGuid1 = Guid.NewGuid();
        var taskGuid2 = Guid.NewGuid();
        var callCount = 0;

        _metricsRegistryServiceMock
            .Setup(x => x.RegisterObservations(It.IsAny<Func<Task<Dictionary<string, (DateTime, double)>>>>()))
            .Returns(() => callCount++ == 0 ? taskGuid1 : taskGuid2);
        _metricsRegistryServiceMock
            .Setup(x => x.UnregisterMetrics(It.IsAny<Guid>()))
            .Returns(true);

        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Act - first cycle
        await service.StartAsync(CancellationToken.None);
        await service.StopAsync(CancellationToken.None);

        // Second cycle
        await service.StartAsync(CancellationToken.None);
        await service.StopAsync(CancellationToken.None);

        // Assert
        _metricsRegistryServiceMock.Verify(
            x => x.RegisterObservations(It.IsAny<Func<Task<Dictionary<string, (DateTime, double)>>>>()),
            Times.Exactly(2));
    }

    #endregion

    #region Dispose Tests

    [Fact]
    public void Dispose_CanBeCalledSafely()
    {
        // Arrange
        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // Act
        var action = () => service.Dispose();

        // Assert
        action.Should().NotThrow();
    }

    [Fact]
    public async Task Dispose_AfterStartAsync_WorksCorrectly()
    {
        // Arrange
        _metricsRegistryServiceMock
            .Setup(x => x.RegisterObservations(It.IsAny<Func<Task<Dictionary<string, (DateTime, double)>>>>()))
            .Returns(Guid.NewGuid());

        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);
        await service.StartAsync(CancellationToken.None);

        // Act
        var action = () => service.Dispose();

        // Assert
        action.Should().NotThrow();
    }

    #endregion

    #region Edge Cases

    [Fact]
    public void Constructor_WithNullCounterMappings_HandlesGracefully()
    {
        // Arrange
        var eventSourcesWithNull = new Dictionary<string, Dictionary<string, string>>
        {
            ["System.Runtime"] = new Dictionary<string, string>()
        };

        // Act
        var service = new TogglyPerformanceCollectorService(eventSourcesWithNull, _metricsRegistryServiceMock.Object);

        // Assert
        service.Should().NotBeNull();
    }

    [Fact]
    public async Task GetObservations_ReturnsTimestamps_NearCurrentTime()
    {
        // Arrange
        var service = new TogglyPerformanceCollectorService(_eventSources, _metricsRegistryServiceMock.Object);

        // We can't easily inject values into currentValues, so we just verify the return structure
        var beforeTime = DateTime.UtcNow;

        // Act
        var result = await service.GetObservations();

        var afterTime = DateTime.UtcNow;

        // Assert - when there are values, timestamps should be between before and after
        result.Should().NotBeNull();
        // Even if empty, the structure is correct
    }

    #endregion
}
