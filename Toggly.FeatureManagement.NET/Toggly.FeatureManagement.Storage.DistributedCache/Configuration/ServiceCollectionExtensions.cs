using Microsoft.Extensions.DependencyInjection;
using System;

namespace Toggly.FeatureManagement.Storage.DistributedCache.Configuration
{
    public static class ServiceCollectionExtensions
    {
        public static IServiceCollection AddTogglyDistributedCacheSnapshotProvider(this IServiceCollection services, Action<TogglySnapshotSettings> togglySnapshotOptions)
        {
            services.Configure(togglySnapshotOptions);

            services.AddSingleton<IFeatureSnapshotProvider, DistributedCacheFeatureSnapshotProvider>();

            return services;
        }

        public static IServiceCollection AddTogglyDistributedCacheSnapshotProvider(this IServiceCollection services, TogglySnapshotSettings togglySnapshotOptions)
        {
            services.AddOptions<TogglySnapshotSettings>()
                .Configure(options =>
                {
                    if (!string.IsNullOrEmpty(togglySnapshotOptions.DocumentName)) options.DocumentName = togglySnapshotOptions.DocumentName;
                });

            services.AddSingleton<IFeatureSnapshotProvider, DistributedCacheFeatureSnapshotProvider>();

            return services;
        }

        public static IServiceCollection AddTogglyDistributedCacheSnapshotProvider(this IServiceCollection services)
        {
            services.AddOptions<TogglySnapshotSettings>()
                .Configure(options =>
                {
                    
                });

            services.AddSingleton<IFeatureSnapshotProvider, DistributedCacheFeatureSnapshotProvider>();

            return services;
        }
    }
}
