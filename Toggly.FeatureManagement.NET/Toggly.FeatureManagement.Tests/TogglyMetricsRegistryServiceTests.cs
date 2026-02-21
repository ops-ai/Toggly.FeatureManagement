using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class TogglyMetricsRegistryServiceTests
{
    private readonly Mock<ILoggerFactory> _loggerFactoryMock;
    private readonly TogglyMetricsRegistryService _service;

    public TogglyMetricsRegistryServiceTests()
    {
        _loggerFactoryMock = new Mock<ILoggerFactory>();
        _loggerFactoryMock.Setup(x => x.CreateLogger(It.IsAny<string>()))
            .Returns(new Mock<ILogger>().Object);

        _service = new TogglyMetricsRegistryService(_loggerFactoryMock.Object);
    }

    #region RegisterMeasurements Tests

    [Fact]
    public void RegisterMeasurements_ReturnsNewGuid()
    {
        // Act
        var id = _service.RegisterMeasurements(() => Task.FromResult(new Dictionary<string, double>()));

        // Assert
        id.Should().NotBeEmpty();
    }

    [Fact]
    public void RegisterMeasurements_MultipleRegistrations_ReturnDifferentGuids()
    {
        // Act
        var id1 = _service.RegisterMeasurements(() => Task.FromResult(new Dictionary<string, double>()));
        var id2 = _service.RegisterMeasurements(() => Task.FromResult(new Dictionary<string, double>()));

        // Assert
        id1.Should().NotBe(id2);
    }

    #endregion

    #region RegisterObservations Tests

    [Fact]
    public void RegisterObservations_ReturnsNewGuid()
    {
        // Act
        var id = _service.RegisterObservations(() => Task.FromResult(new Dictionary<string, (DateTime, double)>()));

        // Assert
        id.Should().NotBeEmpty();
    }

    [Fact]
    public void RegisterObservations_MultipleRegistrations_ReturnDifferentGuids()
    {
        // Act
        var id1 = _service.RegisterObservations(() => Task.FromResult(new Dictionary<string, (DateTime, double)>()));
        var id2 = _service.RegisterObservations(() => Task.FromResult(new Dictionary<string, (DateTime, double)>()));

        // Assert
        id1.Should().NotBe(id2);
    }

    #endregion

    #region RegisterCounters Tests

    [Fact]
    public void RegisterCounters_ReturnsNewGuid()
    {
        // Act
        var id = _service.RegisterCounters(() => Task.FromResult(new Dictionary<string, double>()));

        // Assert
        id.Should().NotBeEmpty();
    }

    [Fact]
    public void RegisterCounters_MultipleRegistrations_ReturnDifferentGuids()
    {
        // Act
        var id1 = _service.RegisterCounters(() => Task.FromResult(new Dictionary<string, double>()));
        var id2 = _service.RegisterCounters(() => Task.FromResult(new Dictionary<string, double>()));

        // Assert
        id1.Should().NotBe(id2);
    }

    #endregion

    #region UnregisterMetrics Tests

    [Fact]
    public void UnregisterMetrics_WithValidMeasurementId_ReturnsTrue()
    {
        // Arrange
        var id = _service.RegisterMeasurements(() => Task.FromResult(new Dictionary<string, double>()));

        // Act
        var result = _service.UnregisterMetrics(id);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void UnregisterMetrics_WithValidObservationId_ReturnsTrue()
    {
        // Arrange
        var id = _service.RegisterObservations(() => Task.FromResult(new Dictionary<string, (DateTime, double)>()));

        // Act
        var result = _service.UnregisterMetrics(id);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void UnregisterMetrics_WithValidCounterId_ReturnsTrue()
    {
        // Arrange
        var id = _service.RegisterCounters(() => Task.FromResult(new Dictionary<string, double>()));

        // Act
        var result = _service.UnregisterMetrics(id);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void UnregisterMetrics_WithInvalidId_ReturnsFalse()
    {
        // Act
        var result = _service.UnregisterMetrics(Guid.NewGuid());

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void UnregisterMetrics_SameIdTwice_ReturnsFalseOnSecondCall()
    {
        // Arrange
        var id = _service.RegisterMeasurements(() => Task.FromResult(new Dictionary<string, double>()));

        // Act
        var result1 = _service.UnregisterMetrics(id);
        var result2 = _service.UnregisterMetrics(id);

        // Assert
        result1.Should().BeTrue();
        result2.Should().BeFalse();
    }

    #endregion

    #region GetMeasurementValuesAsync Tests

    [Fact]
    public async Task GetMeasurementValuesAsync_WithNoHandlers_ReturnsEmptyDictionary()
    {
        // Act
        var result = await _service.GetMeasurementValuesAsync();

        // Assert
        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetMeasurementValuesAsync_WithSingleHandler_ReturnsHandlerValues()
    {
        // Arrange
        var expected = new Dictionary<string, double> { { "metric1", 1.5 }, { "metric2", 2.5 } };
        _service.RegisterMeasurements(() => Task.FromResult(expected));

        // Act
        var result = await _service.GetMeasurementValuesAsync();

        // Assert
        result.Should().HaveCount(2);
        result["metric1"].Should().Be(1.5);
        result["metric2"].Should().Be(2.5);
    }

    [Fact]
    public async Task GetMeasurementValuesAsync_WithMultipleHandlers_AggregatesValues()
    {
        // Arrange
        _service.RegisterMeasurements(() => Task.FromResult(new Dictionary<string, double> { { "metric1", 1.0 } }));
        _service.RegisterMeasurements(() => Task.FromResult(new Dictionary<string, double> { { "metric2", 2.0 } }));

        // Act
        var result = await _service.GetMeasurementValuesAsync();

        // Assert
        result.Should().HaveCount(2);
        result.Should().ContainKey("metric1");
        result.Should().ContainKey("metric2");
    }

    [Fact]
    public async Task GetMeasurementValuesAsync_WithOverlappingKeys_OverwritesValue()
    {
        // Arrange
        _service.RegisterMeasurements(() => Task.FromResult(new Dictionary<string, double> { { "metric", 1.0 } }));
        _service.RegisterMeasurements(() => Task.FromResult(new Dictionary<string, double> { { "metric", 2.0 } }));

        // Act
        var result = await _service.GetMeasurementValuesAsync();

        // Assert
        result.Should().HaveCount(1);
        // The second handler's value should overwrite the first (or vice versa depending on iteration order)
        result.Should().ContainKey("metric");
    }

    [Fact]
    public async Task GetMeasurementValuesAsync_WithThrowingHandler_ContinuesWithOtherHandlers()
    {
        // Arrange
        _service.RegisterMeasurements(() => throw new Exception("Test exception"));
        _service.RegisterMeasurements(() => Task.FromResult(new Dictionary<string, double> { { "metric", 1.0 } }));

        // Act
        var result = await _service.GetMeasurementValuesAsync();

        // Assert
        result.Should().ContainKey("metric");
    }

    #endregion

    #region GetObservationValuesAsync Tests

    [Fact]
    public async Task GetObservationValuesAsync_WithNoHandlers_ReturnsEmptyDictionary()
    {
        // Act
        var result = await _service.GetObservationValuesAsync();

        // Assert
        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetObservationValuesAsync_WithSingleHandler_ReturnsHandlerValues()
    {
        // Arrange
        var now = DateTime.UtcNow;
        var expected = new Dictionary<string, (DateTime, double)>
        {
            { "obs1", (now, 1.5) },
            { "obs2", (now, 2.5) }
        };
        _service.RegisterObservations(() => Task.FromResult(expected));

        // Act
        var result = await _service.GetObservationValuesAsync();

        // Assert
        result.Should().HaveCount(2);
        result["obs1"].Item2.Should().Be(1.5);
        result["obs2"].Item2.Should().Be(2.5);
    }

    [Fact]
    public async Task GetObservationValuesAsync_WithMultipleHandlers_AggregatesValues()
    {
        // Arrange
        var now = DateTime.UtcNow;
        _service.RegisterObservations(() => Task.FromResult(new Dictionary<string, (DateTime, double)> { { "obs1", (now, 1.0) } }));
        _service.RegisterObservations(() => Task.FromResult(new Dictionary<string, (DateTime, double)> { { "obs2", (now, 2.0) } }));

        // Act
        var result = await _service.GetObservationValuesAsync();

        // Assert
        result.Should().HaveCount(2);
    }

    [Fact]
    public async Task GetObservationValuesAsync_WithThrowingHandler_ContinuesWithOtherHandlers()
    {
        // Arrange
        var now = DateTime.UtcNow;
        _service.RegisterObservations(() => throw new Exception("Test exception"));
        _service.RegisterObservations(() => Task.FromResult(new Dictionary<string, (DateTime, double)> { { "obs", (now, 1.0) } }));

        // Act
        var result = await _service.GetObservationValuesAsync();

        // Assert
        result.Should().ContainKey("obs");
    }

    #endregion

    #region GetCounterValuesAsync Tests

    [Fact]
    public async Task GetCounterValuesAsync_WithNoHandlers_ReturnsEmptyDictionary()
    {
        // Act
        var result = await _service.GetCounterValuesAsync();

        // Assert
        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetCounterValuesAsync_WithSingleHandler_ReturnsHandlerValues()
    {
        // Arrange
        var expected = new Dictionary<string, double> { { "counter1", 10 }, { "counter2", 20 } };
        _service.RegisterCounters(() => Task.FromResult(expected));

        // Act
        var result = await _service.GetCounterValuesAsync();

        // Assert
        result.Should().HaveCount(2);
        result["counter1"].Should().Be(10);
        result["counter2"].Should().Be(20);
    }

    [Fact]
    public async Task GetCounterValuesAsync_WithMultipleHandlers_AggregatesValues()
    {
        // Arrange
        _service.RegisterCounters(() => Task.FromResult(new Dictionary<string, double> { { "c1", 1.0 } }));
        _service.RegisterCounters(() => Task.FromResult(new Dictionary<string, double> { { "c2", 2.0 } }));

        // Act
        var result = await _service.GetCounterValuesAsync();

        // Assert
        result.Should().HaveCount(2);
    }

    [Fact]
    public async Task GetCounterValuesAsync_WithThrowingHandler_ContinuesWithOtherHandlers()
    {
        // Arrange
        _service.RegisterCounters(() => throw new Exception("Test exception"));
        _service.RegisterCounters(() => Task.FromResult(new Dictionary<string, double> { { "counter", 1.0 } }));

        // Act
        var result = await _service.GetCounterValuesAsync();

        // Assert
        result.Should().ContainKey("counter");
    }

    #endregion

    #region Integration Tests

    [Fact]
    public async Task FullWorkflow_RegisterUnregisterGetValues()
    {
        // Arrange
        var measurementId = _service.RegisterMeasurements(() => Task.FromResult(new Dictionary<string, double> { { "m", 1.0 } }));
        var observationId = _service.RegisterObservations(() => Task.FromResult(new Dictionary<string, (DateTime, double)> { { "o", (DateTime.UtcNow, 2.0) } }));
        var counterId = _service.RegisterCounters(() => Task.FromResult(new Dictionary<string, double> { { "c", 3.0 } }));

        // Act - Get values before unregistering
        var measurements1 = await _service.GetMeasurementValuesAsync();
        var observations1 = await _service.GetObservationValuesAsync();
        var counters1 = await _service.GetCounterValuesAsync();

        // Assert - Values present
        measurements1.Should().ContainKey("m");
        observations1.Should().ContainKey("o");
        counters1.Should().ContainKey("c");

        // Act - Unregister all
        _service.UnregisterMetrics(measurementId).Should().BeTrue();
        _service.UnregisterMetrics(observationId).Should().BeTrue();
        _service.UnregisterMetrics(counterId).Should().BeTrue();

        // Assert - Values should be gone
        var measurements2 = await _service.GetMeasurementValuesAsync();
        var observations2 = await _service.GetObservationValuesAsync();
        var counters2 = await _service.GetCounterValuesAsync();

        measurements2.Should().BeEmpty();
        observations2.Should().BeEmpty();
        counters2.Should().BeEmpty();
    }

    #endregion
}
