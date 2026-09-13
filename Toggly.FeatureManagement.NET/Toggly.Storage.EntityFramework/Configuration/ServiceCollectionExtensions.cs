using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using System;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Storage.EntityFramework.Configuration
{
    /// <summary>
    /// Extension methods for configuring Entity Framework snapshot provider
    /// </summary>
    public static class ServiceCollectionExtensions
    {
        /// <summary>
        /// Adds a dedicated Entity Framework catalog store for the embedded Toggly runtime.
        /// </summary>
        /// <param name="services">Service collection to configure.</param>
        /// <param name="configureDatabase">Action that configures the catalog database provider.</param>
        /// <returns>The service collection for chaining.</returns>
        /// <remarks>
        /// The host owns schema creation. This registration never calls <c>EnsureCreated</c> or modifies snapshot tables.
        /// </remarks>
        public static IServiceCollection AddTogglyEntityFrameworkCatalogStore(
            this IServiceCollection services,
            Action<DbContextOptionsBuilder> configureDatabase)
        {
            if (services == null) throw new ArgumentNullException(nameof(services));
            if (configureDatabase == null) throw new ArgumentNullException(nameof(configureDatabase));

            services.AddDbContextFactory<TogglyCatalogDbContext>(configureDatabase);
            services.TryAddEnumerable(ServiceDescriptor.Singleton<ITogglyCatalogStore, EntityFrameworkCatalogStore>());
            return services;
        }

        /// <summary>
        /// Adds Toggly Entity Framework snapshot provider with DbContext configuration
        /// </summary>
        /// <param name="services">The service collection</param>
        /// <param name="dbContextOptions">Action to configure the DbContext options (e.g., connection string)</param>
        /// <param name="togglySnapshotOptions">Optional action to configure snapshot settings</param>
        /// <returns>The service collection for chaining</returns>
        public static IServiceCollection AddTogglyEntityFrameworkSnapshotProvider(
            this IServiceCollection services,
            Action<DbContextOptionsBuilder> dbContextOptions,
            Action<TogglySnapshotSettings>? togglySnapshotOptions = null)
        {
            services.AddDbContext<TogglyEntities>(dbContextOptions);

            if (togglySnapshotOptions != null)
            {
                services.Configure(togglySnapshotOptions);
            }
            else
            {
                services.AddOptions<TogglySnapshotSettings>();
            }

            services.AddSingleton<IFeatureSnapshotProvider, EntityFrameworkFeatureSnapshotProvider>();

            return services;
        }

        /// <summary>
        /// Adds Toggly Entity Framework snapshot provider with snapshot settings
        /// </summary>
        /// <param name="services">The service collection</param>
        /// <param name="dbContextOptions">Action to configure the DbContext options</param>
        /// <param name="togglySnapshotOptions">Snapshot settings instance</param>
        /// <returns>The service collection for chaining</returns>
        public static IServiceCollection AddTogglyEntityFrameworkSnapshotProvider(
            this IServiceCollection services,
            Action<DbContextOptionsBuilder> dbContextOptions,
            TogglySnapshotSettings togglySnapshotOptions)
        {
            services.AddDbContext<TogglyEntities>(dbContextOptions);

            services.AddOptions<TogglySnapshotSettings>()
                .Configure(options =>
                {
                    if (!string.IsNullOrEmpty(togglySnapshotOptions.DocumentName))
                        options.DocumentName = togglySnapshotOptions.DocumentName;
                    if (!string.IsNullOrEmpty(togglySnapshotOptions.JwkDocumentName))
                        options.JwkDocumentName = togglySnapshotOptions.JwkDocumentName;
                    options.AutoCreateTable = togglySnapshotOptions.AutoCreateTable;
                });

            services.AddSingleton<IFeatureSnapshotProvider, EntityFrameworkFeatureSnapshotProvider>();

            return services;
        }

        /// <summary>
        /// Adds Toggly Entity Framework snapshot provider using an existing TogglyEntities DbContext registration
        /// </summary>
        /// <param name="services">The service collection</param>
        /// <param name="togglySnapshotOptions">Optional action to configure snapshot settings</param>
        /// <returns>The service collection for chaining</returns>
        /// <remarks>
        /// Use this overload when you have already registered TogglyEntities in your DI container
        /// </remarks>
        public static IServiceCollection AddTogglyEntityFrameworkSnapshotProvider(
            this IServiceCollection services,
            Action<TogglySnapshotSettings>? togglySnapshotOptions = null)
        {
            if (togglySnapshotOptions != null)
            {
                services.Configure(togglySnapshotOptions);
            }
            else
            {
                services.AddOptions<TogglySnapshotSettings>();
            }

            services.AddSingleton<IFeatureSnapshotProvider, EntityFrameworkFeatureSnapshotProvider>();

            return services;
        }
    }
}
