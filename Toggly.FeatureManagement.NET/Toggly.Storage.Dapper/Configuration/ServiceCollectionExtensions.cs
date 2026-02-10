using Microsoft.Extensions.DependencyInjection;
using System;
using System.Data;

namespace Toggly.FeatureManagement.Storage.Dapper.Configuration
{
    /// <summary>
    /// Extension methods for configuring Dapper snapshot provider
    /// </summary>
    public static class ServiceCollectionExtensions
    {
        /// <summary>
        /// Adds Toggly Dapper snapshot provider with connection factory
        /// </summary>
        /// <param name="services">The service collection</param>
        /// <param name="connectionFactory">Factory function to create database connections</param>
        /// <param name="togglySnapshotOptions">Optional action to configure snapshot settings</param>
        /// <returns>The service collection for chaining</returns>
        public static IServiceCollection AddTogglyDapperSnapshotProvider(
            this IServiceCollection services,
            Func<IDbConnection> connectionFactory,
            Action<TogglySnapshotSettings>? togglySnapshotOptions = null)
        {
            services.AddSingleton(connectionFactory);

            if (togglySnapshotOptions != null)
            {
                services.Configure(togglySnapshotOptions);
            }
            else
            {
                services.AddOptions<TogglySnapshotSettings>();
            }

            services.AddSingleton<IFeatureSnapshotProvider, DapperFeatureSnapshotProvider>();

            return services;
        }

        /// <summary>
        /// Adds Toggly Dapper snapshot provider with connection factory and settings
        /// </summary>
        /// <param name="services">The service collection</param>
        /// <param name="connectionFactory">Factory function to create database connections</param>
        /// <param name="togglySnapshotOptions">Snapshot settings instance</param>
        /// <returns>The service collection for chaining</returns>
        public static IServiceCollection AddTogglyDapperSnapshotProvider(
            this IServiceCollection services,
            Func<IDbConnection> connectionFactory,
            TogglySnapshotSettings togglySnapshotOptions)
        {
            services.AddSingleton(connectionFactory);

            services.AddOptions<TogglySnapshotSettings>()
                .Configure(options =>
                {
                    if (!string.IsNullOrEmpty(togglySnapshotOptions.DocumentName))
                        options.DocumentName = togglySnapshotOptions.DocumentName;
                    if (!string.IsNullOrEmpty(togglySnapshotOptions.JwkDocumentName))
                        options.JwkDocumentName = togglySnapshotOptions.JwkDocumentName;
                    if (!string.IsNullOrEmpty(togglySnapshotOptions.TableName))
                        options.TableName = togglySnapshotOptions.TableName;
                    options.AutoCreateTable = togglySnapshotOptions.AutoCreateTable;
                    options.Provider = togglySnapshotOptions.Provider;
                });

            services.AddSingleton<IFeatureSnapshotProvider, DapperFeatureSnapshotProvider>();

            return services;
        }

        /// <summary>
        /// Adds Toggly Dapper snapshot provider using an existing connection factory registration
        /// </summary>
        /// <param name="services">The service collection</param>
        /// <param name="togglySnapshotOptions">Optional action to configure snapshot settings</param>
        /// <returns>The service collection for chaining</returns>
        /// <remarks>
        /// Use this overload when you have already registered Func&lt;IDbConnection&gt; in your DI container
        /// </remarks>
        public static IServiceCollection AddTogglyDapperSnapshotProvider(
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

            services.AddSingleton<IFeatureSnapshotProvider, DapperFeatureSnapshotProvider>();

            return services;
        }
    }
}
