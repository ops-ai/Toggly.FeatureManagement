using Microsoft.Extensions.DependencyInjection;
using System.Collections.Generic;
using Toggly.Metrics.SystemMetrics.Collectors;

namespace Toggly.FeatureManagement.Web.Configuration
{
    public static class ServiceCollectionExtensions
    {
        public static void AddPerformanceMetrics(this IServiceCollection services, Dictionary<string, Dictionary<string, string>> eventSources)
        {
            services.AddHostedService(t => new TogglyPerformanceCollectorService(eventSources, t.GetRequiredService<IMetricsRegistryService>()));
        }
    }
}
