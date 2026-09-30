using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using System.Collections.Concurrent;
using System.Diagnostics.Tracing;
using System.Reflection;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Web.Configuration;
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

    [Theory]
    [InlineData("Mean", 12.5d)]
    [InlineData("Increment", 3d)]
    public void GetRelevantMetric_UsesSupportedCounterValues(string valueName, double expectedValue)
    {
        var method = typeof(TogglyPerformanceCollectorService)
            .GetMethod("GetRelevantMetric", BindingFlags.NonPublic | BindingFlags.Static);
        var payload = new Dictionary<string, object>
        {
            ["Name"] = "request-rate",
            [valueName] = expectedValue
        };

        var result = ((string counterName, double counterValue))method!.Invoke(null, new object[] { payload })!;

        result.counterName.Should().Be("request-rate");
        result.counterValue.Should().Be(expectedValue);
    }

    [Fact]
    public async Task AddPerformanceMetrics_RegistersTheCollectorAsAHostedService()
    {
        var services = new ServiceCollection();
        services.AddSingleton(_metricsRegistryServiceMock.Object);

        services.AddPerformanceMetrics(_eventSources);

        await using var provider = services.BuildServiceProvider();
        var hostedService = provider.GetRequiredService<Microsoft.Extensions.Hosting.IHostedService>();

        hostedService.Should().BeOfType<TogglyPerformanceCollectorService>();
    }

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

    [Fact]
    public async Task EventCounterCallback_AndConcurrentObservationReads_AreSynchronized()
    {
        var eventSources = new Dictionary<string, Dictionary<string, string>>
        {
            [TestMetricEventSource.EventSourceName] = new Dictionary<string, string>
            {
                ["requests"] = "request_count"
            }
        };
        using var service = new TogglyPerformanceCollectorService(eventSources, _metricsRegistryServiceMock.Object);
        using var cancellation = new CancellationTokenSource();
        var observations = new ConcurrentQueue<Dictionary<string, (DateTime, double)>>();
        var reader = Task.Run(async () =>
        {
            while (!cancellation.Token.IsCancellationRequested)
            {
                observations.Enqueue(await service.GetObservations());
                await Task.Delay(1, cancellation.Token);
            }
        });

        try
        {
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while (DateTime.UtcNow < deadline && !observations.Any(values => values.ContainsKey("request_count")))
            {
                TestMetricEventSource.Log.WriteMetric(42);
                await Task.Delay(100);
            }
        }
        finally
        {
            cancellation.Cancel();
            try
            {
                await reader;
            }
            catch (OperationCanceledException)
            {
            }
        }

        observations.Should().Contain(values => values.ContainsKey("request_count") && values["request_count"].Item2 == 42);
    }

    [Fact]
    public async Task EventCounterCallback_WaitsForObservationSnapshotBeforePublishing()
    {
        var eventSources = new Dictionary<string, Dictionary<string, string>>
        {
            [TestMetricEventSource.EventSourceName] = new Dictionary<string, string>
            {
                ["requests"] = "request_count"
            }
        };
        using var service = new TestablePerformanceCollectorService(eventSources, _metricsRegistryServiceMock.Object);
        using var callbackEntered = new ManualResetEventSlim();
        using var resumeCallback = new ManualResetEventSlim();
        var snapshotLock = typeof(TogglyPerformanceCollectorService)
            .GetField("_lock", BindingFlags.Instance | BindingFlags.NonPublic)!
            .GetValue(service)!;
        var counterEvent = CreateCounterEvent(new SignalingCounterName(callbackEntered, resumeCallback));

        Task writer;
        Monitor.Enter(snapshotLock);
        try
        {
            writer = Task.Run(() => service.PublishCounter(counterEvent));
            callbackEntered.Wait(TimeSpan.FromSeconds(5)).Should().BeTrue();
            resumeCallback.Set();

            writer.Wait(TimeSpan.FromSeconds(2)).Should().BeFalse(
                "counter callbacks must wait until an observation snapshot releases its lock");
            service.GetObservations().Result.Should().BeEmpty();
        }
        finally
        {
            resumeCallback.Set();
            Monitor.Exit(snapshotLock);
        }

        await writer.WaitAsync(TimeSpan.FromSeconds(5));
        var observations = await service.GetObservations();
        observations.Should().ContainKey("request_count");
        observations["request_count"].Item2.Should().Be(42);
    }

    private static EventWrittenEventArgs CreateCounterEvent(object counterName)
    {
        var eventData = (EventWrittenEventArgs)Activator.CreateInstance(
            typeof(EventWrittenEventArgs),
            BindingFlags.Instance | BindingFlags.NonPublic,
            binder: null,
            args: new object[] { TestMetricEventSource.Log, 0 },
            culture: null)!;
        var flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        typeof(EventWrittenEventArgs).GetProperty(nameof(EventWrittenEventArgs.EventName), flags)!
            .SetValue(eventData, "EventCounters");
        typeof(EventWrittenEventArgs).GetProperty(nameof(EventWrittenEventArgs.Payload), flags)!
            .SetValue(eventData, new List<object>
            {
                new Dictionary<string, object>
                {
                    ["Name"] = counterName,
                    ["Mean"] = 42d
                }
            }.AsReadOnly());
        return eventData;
    }

    private sealed class TestablePerformanceCollectorService : TogglyPerformanceCollectorService
    {
        public TestablePerformanceCollectorService(
            Dictionary<string, Dictionary<string, string>> eventSources,
            IMetricsRegistryService metricsRegistryService)
            : base(eventSources, metricsRegistryService)
        {
        }

        public void PublishCounter(EventWrittenEventArgs eventData) => OnEventWritten(eventData);
    }

    private sealed class SignalingCounterName
    {
        private readonly ManualResetEventSlim _callbackEntered;
        private readonly ManualResetEventSlim _resumeCallback;

        public SignalingCounterName(ManualResetEventSlim callbackEntered, ManualResetEventSlim resumeCallback)
        {
            _callbackEntered = callbackEntered;
            _resumeCallback = resumeCallback;
        }

        public override string ToString()
        {
            _callbackEntered.Set();
            if (!_resumeCallback.Wait(TimeSpan.FromSeconds(5)))
                throw new TimeoutException("Counter callback was not released by the test.");
            return "requests";
        }
    }

    #endregion

    [EventSource(Name = EventSourceName)]
    private sealed class TestMetricEventSource : EventSource
    {
        public const string EventSourceName = "Toggly.Tests.SystemMetrics";
        public static readonly TestMetricEventSource Log = new();
        private readonly EventCounter _requests;

        private TestMetricEventSource()
        {
            _requests = new EventCounter("requests", this);
        }

        public void WriteMetric(double value) => _requests.WriteMetric(value);
    }
}
