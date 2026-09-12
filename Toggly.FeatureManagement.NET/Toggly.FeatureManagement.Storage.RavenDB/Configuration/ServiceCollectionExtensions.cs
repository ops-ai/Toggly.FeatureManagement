using Microsoft.Extensions.DependencyInjection;
using System;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Storage.RavenDB.Configuration
{
    public static class ServiceCollectionExtensions
    {
        /// <summary>
        /// Adds the authoritative RavenDB catalog store used by the embedded Toggly runtime.
        /// </summary>
        /// <param name="services">Service collection to configure. The host must register an initialized RavenDB document store.</param>
        /// <returns>The service collection for chaining.</returns>
        public static IServiceCollection AddTogglyRavenDbCatalogStore(this IServiceCollection services)
        {
            if (services == null) throw new ArgumentNullException(nameof(services));

            services.TryAddSingleton<ITogglyCatalogStore, RavenDbCatalogStore>();
            return services;
        }

        public static IServiceCollection AddTogglyRavenDbSnapshotProvider(this IServiceCollection services, Action<TogglySnapshotSettings> togglySnapshotOptions)
        {
            services.Configure(togglySnapshotOptions);

            services.AddSingleton<IFeatureSnapshotProvider, RavenDBFeatureSnapshotProvider>();

            return services;
        }

        public static IServiceCollection AddTogglyRavenDbSnapshotProvider(this IServiceCollection services, TogglySnapshotSettings togglySnapshotOptions)
        {
            services.AddOptions<TogglySnapshotSettings>()
                .Configure(options =>
                {
                    if (!string.IsNullOrEmpty(togglySnapshotOptions.DocumentName)) options.DocumentName = togglySnapshotOptions.DocumentName;
                });

            services.AddSingleton<IFeatureSnapshotProvider, RavenDBFeatureSnapshotProvider>();

            return services;
        }

        public static IServiceCollection AddTogglyRavenDbSnapshotProvider(this IServiceCollection services)
        {
            services.AddOptions<TogglySnapshotSettings>()
                .Configure(options =>
                {
                    
                });

            services.AddSingleton<IFeatureSnapshotProvider, RavenDBFeatureSnapshotProvider>();

            return services;
        }
    }
}
