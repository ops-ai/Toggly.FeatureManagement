using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using System;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Storage.DistributedCache.Configuration
{
    /// <summary>
    /// Extension methods for distributed-cache snapshot and embedded catalog storage.
    /// </summary>
    public static class ServiceCollectionExtensions
    {
        /// <summary>
        /// Adds an authoritative embedded catalog store backed by the host's distributed cache.
        /// </summary>
        /// <remarks>
        /// <see cref="CatalogCacheAccessMode.SingleWriter"/> is process-local only. Configure exactly one writer process for each catalog.
        /// </remarks>
        public static IServiceCollection AddTogglyDistributedCacheCatalogStore(
            this IServiceCollection services,
            Action<TogglyDistributedCacheCatalogOptions> configure)
        {
            if (services == null) throw new ArgumentNullException(nameof(services));
            if (configure == null) throw new ArgumentNullException(nameof(configure));

            services.AddOptions<TogglyDistributedCacheCatalogOptions>().Configure(configure);
            services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<TogglyDistributedCacheCatalogOptions>, TogglyDistributedCacheCatalogOptionsValidator>());
            services.TryAddSingleton<CatalogWriterGate>();
            services.TryAddEnumerable(ServiceDescriptor.Singleton<ITogglyCatalogStore, DistributedCacheCatalogStore>());
            return services;
        }

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
