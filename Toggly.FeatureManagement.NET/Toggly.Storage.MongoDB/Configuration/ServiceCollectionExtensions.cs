using Microsoft.Extensions.DependencyInjection;
using MongoDB.Driver;
using System;

namespace Toggly.FeatureManagement.Storage.MongoDB.Configuration
{
    /// <summary>
    /// Extension methods for configuring MongoDB snapshot provider
    /// </summary>
    public static class ServiceCollectionExtensions
    {
        /// <summary>
        /// Adds Toggly MongoDB snapshot provider with connection string
        /// </summary>
        /// <param name="services">The service collection</param>
        /// <param name="connectionString">MongoDB connection string</param>
        /// <param name="togglySnapshotOptions">Optional action to configure snapshot settings</param>
        /// <returns>The service collection for chaining</returns>
        public static IServiceCollection AddTogglyMongoDBSnapshotProvider(
            this IServiceCollection services,
            string connectionString,
            Action<TogglySnapshotSettings>? togglySnapshotOptions = null)
        {
            services.AddSingleton<IMongoClient>(new MongoClient(connectionString));

            if (togglySnapshotOptions != null)
            {
                services.Configure(togglySnapshotOptions);
            }
            else
            {
                services.AddOptions<TogglySnapshotSettings>();
            }

            services.AddSingleton<IFeatureSnapshotProvider, MongoDBFeatureSnapshotProvider>();

            return services;
        }

        /// <summary>
        /// Adds Toggly MongoDB snapshot provider with MongoClient settings
        /// </summary>
        /// <param name="services">The service collection</param>
        /// <param name="clientSettings">MongoDB client settings</param>
        /// <param name="togglySnapshotOptions">Optional action to configure snapshot settings</param>
        /// <returns>The service collection for chaining</returns>
        public static IServiceCollection AddTogglyMongoDBSnapshotProvider(
            this IServiceCollection services,
            MongoClientSettings clientSettings,
            Action<TogglySnapshotSettings>? togglySnapshotOptions = null)
        {
            services.AddSingleton<IMongoClient>(new MongoClient(clientSettings));

            if (togglySnapshotOptions != null)
            {
                services.Configure(togglySnapshotOptions);
            }
            else
            {
                services.AddOptions<TogglySnapshotSettings>();
            }

            services.AddSingleton<IFeatureSnapshotProvider, MongoDBFeatureSnapshotProvider>();

            return services;
        }

        /// <summary>
        /// Adds Toggly MongoDB snapshot provider with existing IMongoClient
        /// </summary>
        /// <param name="services">The service collection</param>
        /// <param name="client">Existing MongoDB client instance</param>
        /// <param name="togglySnapshotOptions">Optional action to configure snapshot settings</param>
        /// <returns>The service collection for chaining</returns>
        public static IServiceCollection AddTogglyMongoDBSnapshotProvider(
            this IServiceCollection services,
            IMongoClient client,
            Action<TogglySnapshotSettings>? togglySnapshotOptions = null)
        {
            services.AddSingleton(client);

            if (togglySnapshotOptions != null)
            {
                services.Configure(togglySnapshotOptions);
            }
            else
            {
                services.AddOptions<TogglySnapshotSettings>();
            }

            services.AddSingleton<IFeatureSnapshotProvider, MongoDBFeatureSnapshotProvider>();

            return services;
        }

        /// <summary>
        /// Adds Toggly MongoDB snapshot provider using an existing IMongoClient registration
        /// </summary>
        /// <param name="services">The service collection</param>
        /// <param name="togglySnapshotOptions">Optional action to configure snapshot settings</param>
        /// <returns>The service collection for chaining</returns>
        /// <remarks>
        /// Use this overload when you have already registered IMongoClient in your DI container
        /// </remarks>
        public static IServiceCollection AddTogglyMongoDBSnapshotProvider(
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

            services.AddSingleton<IFeatureSnapshotProvider, MongoDBFeatureSnapshotProvider>();

            return services;
        }
    }
}
