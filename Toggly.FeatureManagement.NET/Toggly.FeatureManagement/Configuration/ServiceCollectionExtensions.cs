﻿using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Polly.Extensions.Http;
using Polly;
using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using Toggly.FeatureManagement.Helpers;
using System.Collections.Generic;
using Grpc.Net.Client.Web;
using Toggly.Web;
using Grpc.Net.Client.Configuration;
using Grpc.Core;

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
                    if (!string.IsNullOrEmpty(togglyOptions.AppVersion)) options.AppVersion = togglyOptions.AppVersion;
                    if (!string.IsNullOrEmpty(togglyOptions.InstanceName)) options.InstanceName = togglyOptions.InstanceName;
                });

            AddCoreServices(services);

            return services;
        }

        public static IServiceCollection AddToggly(this IServiceCollection services)
        {
            AddCoreServices(services);

            return services;
        }

        private static IAsyncPolicy<HttpResponseMessage> GetRetryPolicy()
        {
            return HttpPolicyExtensions
                .HandleTransientHttpError()
                .OrResult(msg => msg.StatusCode == HttpStatusCode.NotFound)
                .WaitAndRetryAsync(8, retryAttempt => TimeSpan.FromSeconds(Math.Pow(2, retryAttempt)));
        }

        private static void AddCoreServices(IServiceCollection services)
        {
            services.AddHttpClient("toggly", (sp, config) =>
            {
                var baseUrl = sp.GetRequiredService<IOptions<TogglySettings>>().Value.BaseUrl;

                config.BaseAddress = new Uri(baseUrl ?? "https://app.toggly.io/");
            })
            .SetHandlerLifetime(TimeSpan.FromMinutes(60))
            .AddPolicyHandler(GetRetryPolicy())
            .ConfigurePrimaryHttpMessageHandler(messageHandler =>
            {
                var handler = new HttpClientHandler();

                if (handler.SupportsAutomaticDecompression)
                    handler.AutomaticDecompression = DecompressionMethods.Deflate | DecompressionMethods.GZip;

                return handler;
            });
            
            var defaultMethodConfig = new MethodConfig
            {
                Names = { MethodName.Default },
                RetryPolicy = new RetryPolicy
                {
                    MaxAttempts = 10,
                    InitialBackoff = TimeSpan.FromSeconds(1),
                    MaxBackoff = TimeSpan.FromSeconds(10),
                    BackoffMultiplier = 1.5,
                    RetryableStatusCodes = { StatusCode.Unavailable, StatusCode.DataLoss, StatusCode.Aborted, StatusCode.OutOfRange, StatusCode.Cancelled, StatusCode.DeadlineExceeded, StatusCode.AlreadyExists, StatusCode.Internal, StatusCode.OutOfRange, StatusCode.Unavailable, StatusCode.Unknown }
                }
            };
            services.AddGrpcClient<Metrics.MetricsClient>((sp, options) =>
            {
                var baseUrl = sp.GetRequiredService<IOptions<TogglySettings>>().Value.BaseUrl;
                options.Address = new Uri(baseUrl ?? "https://app.toggly.io");
                options.ChannelOptionsActions.Add(opt => opt.ServiceConfig = new ServiceConfig { MethodConfigs = { defaultMethodConfig } });
            }).ConfigurePrimaryHttpMessageHandler(() => new GrpcWebHandler(new HttpClientHandler()));
            services.AddGrpcClient<Usage.UsageClient>((sp, options) =>
            {
                var baseUrl = sp.GetRequiredService<IOptions<TogglySettings>>().Value.BaseUrl;
                options.Address = new Uri(baseUrl ?? "https://app.toggly.io");
                options.ChannelOptionsActions.Add(opt => opt.ServiceConfig = new ServiceConfig { MethodConfigs = { defaultMethodConfig } });

            }).ConfigurePrimaryHttpMessageHandler(() => new GrpcWebHandler(new HttpClientHandler()));

            services.AddSingleton<IMetricsRegistryService, TogglyMetricsRegistryService>();

            services.AddSingleton<TogglyFeatureStateService>();
            services.AddSingleton<IFeatureStateInternalService>(x => x.GetRequiredService<TogglyFeatureStateService>());
            services.AddSingleton<IFeatureStateService>(x => x.GetRequiredService<TogglyFeatureStateService>());

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

        public static IFeatureManagementBuilder AddTogglyFeatureManagement(this IServiceCollection services)
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

            return featureManagement;
        }
    }
}
