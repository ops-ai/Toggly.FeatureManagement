using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Toggly.FeatureManagement.Context;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Polly.Extensions.Http;
using Polly;
using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using Toggly.FeatureManagement.Helpers;
using Grpc.Net.Client.Web;
using Toggly.Web;
using Grpc.Net.Client.Configuration;
using Grpc.Core;

namespace Toggly.FeatureManagement.Configuration
{
    /// <summary>
    /// Registers Toggly feature management, HTTP clients, gRPC clients, and related services.
    /// </summary>
    public static class ServiceCollectionExtensions
    {
        /// <summary>
        /// Adds Toggly services using configuration from the supplied setup action.
        /// </summary>
        /// <param name="services">The application service collection.</param>
        /// <param name="togglyOptions">Configures <see cref="TogglySettings"/>.</param>
        /// <returns><paramref name="services"/> for chaining.</returns>
        public static IServiceCollection AddToggly(this IServiceCollection services, Action<TogglySettings> togglyOptions)
        {
            services.Configure(togglyOptions);

            AddCoreServices(services);

            return services;
        }

        /// <summary>
        /// Adds Toggly services using the provided settings instance.
        /// </summary>
        /// <param name="services">The application service collection.</param>
        /// <param name="togglyOptions">Toggly options to apply.</param>
        /// <returns><paramref name="services"/> for chaining.</returns>
        public static IServiceCollection AddToggly(this IServiceCollection services, TogglySettings togglyOptions)
        {
            if (togglyOptions == null)
                throw new ArgumentNullException(nameof(togglyOptions));

            services.AddOptions<TogglySettings>()
                .Configure(options =>
                {
                    if (!string.IsNullOrEmpty(togglyOptions.AppKey))
                        options.AppKey = togglyOptions.AppKey;
                    options.BaseUrl = !string.IsNullOrEmpty(togglyOptions.BaseUrl)
                        ? togglyOptions.BaseUrl
                        : "https://app.toggly.io/";
                    if (!string.IsNullOrEmpty(togglyOptions.DefinitionsBaseUrl))
                        options.DefinitionsBaseUrl = togglyOptions.DefinitionsBaseUrl;
                    if (!string.IsNullOrEmpty(togglyOptions.Environment))
                        options.Environment = togglyOptions.Environment;
                    if (!string.IsNullOrEmpty(togglyOptions.AppVersion))
                        options.AppVersion = togglyOptions.AppVersion;
                    if (!string.IsNullOrEmpty(togglyOptions.InstanceName))
                        options.InstanceName = togglyOptions.InstanceName;

                    // Security-sensitive settings must be copied (previously dropped silently).
                    options.UseSignedDefinitions = togglyOptions.UseSignedDefinitions;
                    options.UndefinedEnabledOnDevelopment = togglyOptions.UndefinedEnabledOnDevelopment;
                    options.JwksCacheDuration = togglyOptions.JwksCacheDuration;
                    if (togglyOptions.AllowedKeyIds != null)
                        options.AllowedKeyIds = togglyOptions.AllowedKeyIds;
                    if (togglyOptions.OnError != null)
                        options.OnError = togglyOptions.OnError;
                    options.RegisterContextsOnStartup = togglyOptions.RegisterContextsOnStartup;
                });

            AddCoreServices(services);

            return services;
        }

        /// <summary>
        /// Adds Toggly services. Expects <see cref="TogglySettings"/> to be configured separately (e.g. from configuration).
        /// </summary>
        /// <param name="services">The application service collection.</param>
        /// <returns><paramref name="services"/> for chaining.</returns>
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

        private static IAsyncPolicy<HttpResponseMessage> GetAppRetryPolicy()
        {
            return HttpPolicyExtensions
                .HandleTransientHttpError()
                .WaitAndRetryAsync(2, retryAttempt => TimeSpan.FromSeconds(Math.Pow(2, retryAttempt)));
        }

        private static void AddCoreServices(IServiceCollection services)
        {
            services.AddHttpClient("toggly", (sp, config) =>
            {
                var settings = sp.GetRequiredService<IOptions<TogglySettings>>().Value;
                var definitionsBaseUrl = settings.DefinitionsBaseUrl ?? "https://definitions.toggly.io/";

                config.BaseAddress = new Uri(definitionsBaseUrl);
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

            services.AddHttpClient("toggly-app", (sp, config) =>
            {
                var settings = sp.GetRequiredService<IOptions<TogglySettings>>().Value;
                var baseUrl = settings.BaseUrl ?? "https://app.toggly.io/";
                config.BaseAddress = new Uri(baseUrl);
            })
            .SetHandlerLifetime(TimeSpan.FromMinutes(60))
            .AddPolicyHandler(GetAppRetryPolicy());

            services.AddOptions<EntityContextRegistryOptions>();
            services.TryAddSingleton<EntityContextRegistry>(EntityContextServiceCollectionExtensions.CreateRegistry);
            services.TryAddSingleton<ITogglyEntityContextResolver, TogglyEntityContextResolver>();

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
            services.AddSingleton<IFeatureDefinitionModelProvider>(x => x.GetRequiredService<TogglyFeatureProvider>());
            services.AddSingleton<IFeatureProviderDebug>(x => x.GetRequiredService<TogglyFeatureProvider>());
            services.AddSingleton<ISecureFeatureProvider>(x => x.GetRequiredService<TogglyFeatureProvider>());

            services.AddHostedService<EntityContextRegistrationHostedService>();

            services.AddSingleton<TogglyUsageStatsProvider>();
            services.AddSingleton<IFeatureUsageStatsProvider>(x => x.GetRequiredService<TogglyUsageStatsProvider>());
            services.AddSingleton<IUsageStatsDebug>(x => x.GetRequiredService<TogglyUsageStatsProvider>());

            services.AddSingleton<TogglyMetricsService>();
            services.AddSingleton<IMetricsService>(x => x.GetRequiredService<TogglyMetricsService>());
            services.AddSingleton<IMetricsDebug>(x => x.GetRequiredService<TogglyMetricsService>());
        }

        /// <summary>
        /// Adds Microsoft Feature Management with Toggly filters and decorates <see cref="IFeatureManager"/> with <see cref="TogglyFeatureManager"/>.
        /// </summary>
        /// <param name="services">The application service collection.</param>
        /// <returns>The feature management builder for further configuration.</returns>
        /// <remarks>
        /// Registers Definitions-aligned <see cref="Filters.TogglyPercentageFilter"/> and
        /// <see cref="Filters.TogglyTargetingFilter"/> and removes stock
        /// <see cref="PercentageFilter"/> / <see cref="TargetingFilter"/> so their
        /// reversed <c>userId\nhint</c> hash cannot win for default rollout.
        /// Prefer <see cref="WithTogglyTargeting{T}"/> over Microsoft's
        /// <c>WithTargeting</c> (which re-registers the stock targeting filter).
        /// </remarks>
        public static IFeatureManagementBuilder AddTogglyFeatureManagement(this IServiceCollection services)
        {
            var featureManagement = services.AddFeatureManagement()
                .AddFeatureFilter<TimeWindowFilter>()
                .AddFeatureFilter<ContextPropertyFilter>();

            // AddFeatureManagement auto-registers stock PercentageFilter; remove it so
            // Definitions-aligned sticky Percentage is the only Microsoft.Percentage match.
            RemoveFeatureFilter(services, typeof(PercentageFilter));
            RemoveFeatureFilter(services, typeof(TargetingFilter));

            featureManagement
                .AddFeatureFilter<Filters.TogglyPercentageFilter>()
                .AddFeatureFilter<Filters.TogglyTargetingFilter>();

            services.Decorate<IFeatureManager, TogglyFeatureManager>();
            // Fail closed: unknown filters throw instead of being ignored (which can enable flags).
            // Opt into IgnoreMissingFeatureFilters = true only if you intentionally accept that risk.
            services.Configure<FeatureManagementOptions>(options =>
            {
                options.IgnoreMissingFeatureFilters = false;
            });

            return featureManagement;
        }

        /// <summary>
        /// Registers a targeting context accessor for sticky Percentage / Targeting /
        /// segment evaluation without re-adding stock <see cref="TargetingFilter"/>.
        /// </summary>
        public static IFeatureManagementBuilder WithTogglyTargeting<T>(this IFeatureManagementBuilder builder)
            where T : class, ITargetingContextAccessor
        {
#if NET6_0_OR_GREATER
            ArgumentNullException.ThrowIfNull(builder);
#else
            if (builder == null)
                throw new ArgumentNullException(nameof(builder));
#endif

            builder.Services.AddSingleton<ITargetingContextAccessor, T>();
            RemoveFeatureFilter(builder.Services, typeof(TargetingFilter));
            builder.AddFeatureFilter<Filters.TogglyTargetingFilter>();
            return builder;
        }

        private static void RemoveFeatureFilter(IServiceCollection services, Type implementationType)
        {
            var descriptors = services
                .Where(d => d.ServiceType == typeof(IFeatureFilterMetadata) && d.ImplementationType == implementationType)
                .ToList();

            foreach (var descriptor in descriptors)
                services.Remove(descriptor);
        }
    }
}
