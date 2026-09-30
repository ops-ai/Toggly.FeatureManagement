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
