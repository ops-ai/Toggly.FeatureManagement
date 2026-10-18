using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using System.Reflection;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Web.Configuration;
using Toggly.Metrics.SystemMetrics.Collectors;
using Xunit;

namespace Toggly.Metrics.SystemMetrics.Tests;

public class ServiceCollectionExtensionsTests
{
    private static readonly Dictionary<string, string> ExpectedSystemRuntimeCounters = new()
    {
        ["time-in-gc"] = "TimeInGC",
        ["alloc-rate"] = "AllocationRate",
        ["cpu-usage"] = "CpuUsage",
        ["exception-count"] = "ExceptionCount",
        ["gc-heap-size"] = "GCHeapSize",
        ["working-set"] = "MemoryWorkingSet",
    };

    [Fact]
    public void DefaultSystemRuntimeMetrics_MatchesSaaSStartupCatalog()
    {
        ServiceCollectionExtensions.DefaultSystemRuntimeMetrics.Should().ContainKey("System.Runtime");
        ServiceCollectionExtensions.DefaultSystemRuntimeMetrics["System.Runtime"]
            .Should()
            .BeEquivalentTo(ExpectedSystemRuntimeCounters);
    }

    [Fact]
    public async Task AddDefaultSystemMetrics_RegistersTheCollectorAsAHostedService()
    {
        var metricsRegistryServiceMock = new Mock<IMetricsRegistryService>();
        var services = new ServiceCollection();
        services.AddSingleton(metricsRegistryServiceMock.Object);

        services.AddDefaultSystemMetrics();

        await using var provider = services.BuildServiceProvider();
        var hostedService = provider.GetRequiredService<Microsoft.Extensions.Hosting.IHostedService>();

        hostedService.Should().BeOfType<TogglyPerformanceCollectorService>();
    }

    [Fact]
    public async Task AddDefaultSystemMetrics_ConfiguresSystemRuntimeCounters()
    {
        var metricsRegistryServiceMock = new Mock<IMetricsRegistryService>();
        var services = new ServiceCollection();
        services.AddSingleton(metricsRegistryServiceMock.Object);

        services.AddDefaultSystemMetrics();

        await using var provider = services.BuildServiceProvider();
        var hostedService = (TogglyPerformanceCollectorService)provider.GetRequiredService<Microsoft.Extensions.Hosting.IHostedService>();

        var eventSourcesField = typeof(TogglyPerformanceCollectorService)
            .GetField("_eventSources", BindingFlags.NonPublic | BindingFlags.Instance);
        var eventSources = (Dictionary<string, Dictionary<string, string>>)eventSourcesField!.GetValue(hostedService)!;

        eventSources.Should().ContainKey("System.Runtime");
        eventSources["System.Runtime"].Should().BeEquivalentTo(ExpectedSystemRuntimeCounters);
        eventSources.Should().HaveCount(1);
    }
}
