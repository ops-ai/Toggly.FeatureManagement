using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using System;
using System.Collections.Generic;
using System.Text;
using Toggly.FeatureManagement.Helpers;

namespace Toggly.FeatureManagement.Configuration
{
    public static class ServiceCollectionExtensions
    {
        public static IServiceCollection AddToggly(this IServiceCollection services, Action<TogglySettings> togglyOptions)
        {
            services.Configure(togglyOptions);

            AddCoreServices(services);

            return services;
        }

        public static IServiceCollection AddToggly(this IServiceCollection services, TogglySettings togglyOptions)
        {
            services.AddOptions<TogglySettings>()
                .Configure(options =>
                {
                    if (!string.IsNullOrEmpty(togglyOptions.AppKey)) options.AppKey = togglyOptions.AppKey;
                    if (!string.IsNullOrEmpty(togglyOptions.BaseUrl)) options.BaseUrl = togglyOptions.BaseUrl;
                    if (!string.IsNullOrEmpty(togglyOptions.Environment)) options.Environment = togglyOptions.Environment;
                });

            AddCoreServices(services);

            return services;
        }

        public static IServiceCollection AddToggly(this IServiceCollection services)
        {
            AddCoreServices(services);

            return services;
        }

        private static void AddCoreServices(IServiceCollection services)
        {
            services.AddHttpClient("toggly", (sp, config) =>
            {
                var baseUrl = sp.GetRequiredService<IOptions<TogglySettings>>().Value.BaseUrl;

                config.BaseAddress = new Uri(baseUrl ?? "https://app.toggly.io/");
            });

            services.AddSingleton<IFeatureDefinitionProvider, TogglyFeatureProvider>();
            services.AddSingleton<IFeatureUsageStatsProvider, TogglyUsageStatsProvider>();
        }

        public static IServiceCollection AddTogglyFeatureManagement(this IServiceCollection services)
        {
            services.AddFeatureManagement()
                .AddFeatureFilter<PercentageFilter>()
                .AddFeatureFilter<TimeWindowFilter>()
                .AddFeatureFilter<TargetingFilter>();
            services.Decorate<IFeatureManager, TogglyFeatureManager>();
            services.Configure<FeatureManagementOptions>(options =>
            {
                options.IgnoreMissingFeatureFilters = true;
            });

            return services;
        }
    }
}
