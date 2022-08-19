using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
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
                    options.BaseUrl = !string.IsNullOrEmpty(togglyOptions.BaseUrl) ? togglyOptions.BaseUrl : "https://app.toggly.io/";
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
            }).ConfigurePrimaryHttpMessageHandler(messageHandler =>
            {
                var handler = new HttpClientHandler();

                if (handler.SupportsAutomaticDecompression)
                    handler.AutomaticDecompression = DecompressionMethods.Deflate | DecompressionMethods.GZip;

                return handler;
            });

            services.AddSingleton<TogglyFeatureProvider>();
            services.AddSingleton<IFeatureDefinitionProvider>(x => x.GetRequiredService<TogglyFeatureProvider>());
            services.AddSingleton<IFeatureProviderDebug>(x => x.GetRequiredService<TogglyFeatureProvider>());

            services.AddSingleton<TogglyUsageStatsProvider>();
            services.AddSingleton<IFeatureUsageStatsProvider>(x => x.GetRequiredService<TogglyUsageStatsProvider>());
            services.AddSingleton<IUsageStatsDebug>(x => x.GetRequiredService<TogglyUsageStatsProvider>());

            services.AddSingleton<TogglyMetricsService>();
            services.AddSingleton<IMetricsService>(x => x.GetRequiredService<TogglyMetricsService>());
            services.AddSingleton<IMetricsDebug>(x => x.GetRequiredService<TogglyMetricsService>());
        }

        public static IServiceCollection AddTogglyFeatureManagement(this IServiceCollection services)
        {
            var featureManagement = services.AddFeatureManagement()
                .AddFeatureFilter<PercentageFilter>()
                .AddFeatureFilter<TimeWindowFilter>();

            if (services.Any(t => t.ImplementationType?.IsAssignableFrom(typeof(ITargetingContextAccessor)) ?? false))
                featureManagement.AddFeatureFilter<TargetingFilter>();

            services.Decorate<IFeatureManager, TogglyFeatureManager>();
            services.Configure<FeatureManagementOptions>(options =>
            {
                options.IgnoreMissingFeatureFilters = true;
            });

            return services;
        }
    }
}
