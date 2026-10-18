using Microsoft.Extensions.DependencyInjection;
using System.Collections.Generic;
using Toggly.Metrics.SystemMetrics.Collectors;

namespace Toggly.FeatureManagement.Web.Configuration
{
    /// <summary>
    /// Registers system performance metric collectors.
    /// </summary>
    public static class ServiceCollectionExtensions
    {
        /// <summary>
        /// Default <c>System.Runtime</c> event counter names used by the Toggly SaaS app.
        /// </summary>
        public static IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> DefaultSystemRuntimeMetrics { get; } =
            new Dictionary<string, IReadOnlyDictionary<string, string>>
            {
                ["System.Runtime"] = new Dictionary<string, string>
                {
                    ["time-in-gc"] = "TimeInGC",
                    ["alloc-rate"] = "AllocationRate",
                    ["cpu-usage"] = "CpuUsage",
                    ["exception-count"] = "ExceptionCount",
                    ["gc-heap-size"] = "GCHeapSize",
                    ["working-set"] = "MemoryWorkingSet",
                }
            };

        /// <summary>
        /// Registers the default <c>System.Runtime</c> performance counters
        /// (<see cref="DefaultSystemRuntimeMetrics"/>).
        /// </summary>
        /// <param name="services">Service collection receiving the collector.</param>
        public static void AddDefaultSystemMetrics(this IServiceCollection services)
        {
            var eventSources = new Dictionary<string, Dictionary<string, string>>();
            foreach (var source in DefaultSystemRuntimeMetrics)
            {
                eventSources[source.Key] = new Dictionary<string, string>(source.Value);
            }

            services.AddPerformanceMetrics(eventSources);
        }

        /// <summary>
        /// Registers a hosted collector for the supplied runtime event sources.
        /// </summary>
        /// <param name="services">Service collection receiving the collector.</param>
        /// <param name="eventSources">Event sources and their counter-to-metric mappings.</param>
        public static void AddPerformanceMetrics(this IServiceCollection services, Dictionary<string, Dictionary<string, string>> eventSources)
        {
            services.AddHostedService(t => new TogglyPerformanceCollectorService(eventSources, t.GetRequiredService<IMetricsRegistryService>()));
        }
    }
}
