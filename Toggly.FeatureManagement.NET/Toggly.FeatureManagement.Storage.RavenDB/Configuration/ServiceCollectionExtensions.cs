using Microsoft.Extensions.DependencyInjection;
using System;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Storage.RavenDB.Configuration
{
    /// <summary>
    /// Registers RavenDB-backed Toggly snapshot and embedded catalog services.
    /// </summary>
    public static class ServiceCollectionExtensions
    {
        /// <summary>
        /// Adds the authoritative RavenDB catalog store used by the embedded Toggly runtime.
        /// </summary>
        /// <param name="services">Service collection to configure. The host must register an initialized RavenDB document store.</param>
        /// <returns>The service collection for chaining.</returns>
        public static IServiceCollection AddTogglyRavenDbCatalogStore(this IServiceCollection services)
        {
#if NET6_0_OR_GREATER
            ArgumentNullException.ThrowIfNull(services);
#else
            if (services == null) throw new ArgumentNullException(nameof(services));
#endif

            services.TryAddEnumerable(ServiceDescriptor.Singleton<ITogglyCatalogStore, RavenDbCatalogStore>());
            return services;
        }

        /// <summary>
        /// Registers the RavenDB snapshot provider and configures its document names.
        /// </summary>
        /// <param name="services">Service collection to configure.</param>
        /// <param name="togglySnapshotOptions">Configuration callback for snapshot document names.</param>
        /// <returns>The configured service collection.</returns>
        public static IServiceCollection AddTogglyRavenDbSnapshotProvider(this IServiceCollection services, Action<TogglySnapshotSettings> togglySnapshotOptions)
        {
            services.Configure(togglySnapshotOptions);

            services.AddSingleton<IFeatureSnapshotProvider, RavenDBFeatureSnapshotProvider>();

            return services;
        }

        /// <summary>
        /// Registers the RavenDB snapshot provider using supplied snapshot document names.
        /// </summary>
        /// <param name="services">Service collection to configure.</param>
        /// <param name="togglySnapshotOptions">Snapshot document name settings.</param>
        /// <returns>The configured service collection.</returns>
        public static IServiceCollection AddTogglyRavenDbSnapshotProvider(this IServiceCollection services, TogglySnapshotSettings togglySnapshotOptions)
        {
            services.AddOptions<TogglySnapshotSettings>()
                .Configure(options =>
                {
                    if (!string.IsNullOrEmpty(togglySnapshotOptions.DocumentName)) options.DocumentName = togglySnapshotOptions.DocumentName;
                    if (!string.IsNullOrEmpty(togglySnapshotOptions.JwkDocumentName)) options.JwkDocumentName = togglySnapshotOptions.JwkDocumentName;
                });

            services.AddSingleton<IFeatureSnapshotProvider, RavenDBFeatureSnapshotProvider>();

            return services;
        }

        /// <summary>
        /// Registers the RavenDB snapshot provider with default document names.
        /// </summary>
        /// <param name="services">Service collection to configure.</param>
        /// <returns>The configured service collection.</returns>
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
