using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Context;

namespace Toggly.FeatureManagement.Embedded;

public static class ServiceCollectionExtensions
{
    public static IFeatureManagementBuilder AddTogglyEmbedded(this IServiceCollection services, Action<TogglyEmbeddedOptions>? configure = null)
    {
        ArgumentNullException.ThrowIfNull(services);
        if (!services.EnsureTogglyRuntimeMode(TogglyRuntimeMode.Embedded)) return services.AddFeatureManagement();

        services.AddOptions<TogglyEmbeddedOptions>().Configure(configure ?? (_ => { }))
            .PostConfigure<IHostEnvironment>((options, environment) => { if (string.IsNullOrWhiteSpace(options.CatalogName)) options.CatalogName = environment.ApplicationName; })
            .ValidateOnStart();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<TogglyEmbeddedOptions>, TogglyEmbeddedOptionsValidator>());
        services.AddOptions<EntityContextRegistryOptions>();
        services.TryAddSingleton<EntityContextRegistry>(EntityContextServiceCollectionExtensions.CreateRegistry);
        services.TryAddSingleton<ITogglyEntityContextResolver, TogglyEntityContextResolver>();
        services.TryAddSingleton<EmbeddedContextSchemaProvider>(p => new EmbeddedContextSchemaProvider(p.GetRequiredService<EntityContextRegistry>()));
        services.TryAddSingleton<TogglyFeatureStateService>();
        services.TryAddSingleton<IFeatureStateInternalService>(p => p.GetRequiredService<TogglyFeatureStateService>());
        services.TryAddSingleton<IFeatureStateService>(p => p.GetRequiredService<TogglyFeatureStateService>());
        services.TryAddSingleton<EmbeddedFeatureProvider>();
        services.TryAddSingleton<IFeatureDefinitionProvider>(p => p.GetRequiredService<EmbeddedFeatureProvider>());
        services.TryAddSingleton<IFeatureDefinitionModelProvider>(p => p.GetRequiredService<EmbeddedFeatureProvider>());
        services.TryAddSingleton<ISecureFeatureProvider>(p => p.GetRequiredService<EmbeddedFeatureProvider>());
        services.TryAddSingleton<IFeatureProviderDebug>(p => p.GetRequiredService<EmbeddedFeatureProvider>());
        services.TryAddSingleton<IEvaluationSnapshotScope>(p => p.GetRequiredService<EmbeddedFeatureProvider>());
        services.TryAddSingleton<NoOpUsageStatsProvider>();
        services.TryAddSingleton<IFeatureUsageStatsProvider>(p => p.GetRequiredService<NoOpUsageStatsProvider>());
        services.TryAddSingleton<IUsageStatsDebug>(p => p.GetRequiredService<NoOpUsageStatsProvider>());
        services.TryAddSingleton<NoOpMetricsService>();
        services.TryAddSingleton<IMetricsService>(p => p.GetRequiredService<NoOpMetricsService>());
        services.TryAddSingleton<IMetricsDebug>(p => p.GetRequiredService<NoOpMetricsService>());
        services.TryAddSingleton<EmbeddedCatalogCoordinator>(p =>
        {
            var stores = p.GetServices<ITogglyCatalogStore>().ToArray();
            if (stores.Length != 1) throw new InvalidOperationException($"Toggly embedded requires exactly one ITogglyCatalogStore; found {stores.Length}.");
            return new EmbeddedCatalogCoordinator(stores[0], p.GetRequiredService<EmbeddedFeatureProvider>(), p.GetRequiredService<IOptions<TogglyEmbeddedOptions>>().Value, p.GetRequiredService<IFeatureStateInternalService>(), p.GetRequiredService<IEmbeddedClock>());
        });
        services.TryAddSingleton<IEmbeddedClock, SystemEmbeddedClock>();
        services.TryAddSingleton<IEmbeddedRefreshTimerFactory, PeriodicEmbeddedRefreshTimerFactory>();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, EmbeddedCatalogRefreshService>());
        return services.AddTogglyFeatureManagement();
    }
}
