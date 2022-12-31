using Microsoft.Extensions.DependencyInjection;
using System;

namespace Toggly.FeatureManagement.Storage.RavenDB.Configuration
{
    public static class ServiceCollectionExtensions
    {
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
