using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Embedded;
using Toggly.FeatureManagement.Web.Configuration;
using Toggly.FeatureManagement.Web.Filters;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Registers the embedded runtime and its server-rendered dashboard.</summary>
public static class ServiceCollectionExtensions
{
    /// <summary>Adds an offline Toggly dashboard without changing host authentication configuration.</summary>
    public static IFeatureManagementBuilder AddTogglyDashboard(this IServiceCollection services, Action<TogglyEmbeddedOptions>? configure = null)
    {
        ArgumentNullException.ThrowIfNull(services);

        var featureManagement = services.AddTogglyEmbedded(configure);
        services.AddTogglyHttpContext();
        featureManagement
            .AddFeatureFilter<BrowserFamilyFilter>()
            .AddFeatureFilter<BrowserLanguageFilter>()
            .AddFeatureFilter<CountryFilter>()
            .AddFeatureFilter<DeviceTypeFilter>()
            .AddFeatureFilter<OSFilter>()
            .AddFeatureFilter<UserClaimsFilter>();

        services.AddAntiforgery();
        services.AddControllersWithViews()
            .AddApplicationPart(typeof(ServiceCollectionExtensions).Assembly);
        services.TryAddScoped<TogglyDashboardAccessFilter>();
        services.TryAddScoped<TogglyDashboardNoStoreFilter>();
        services.TryAddScoped<TogglyDashboardFormLimitsFilter>();
        return featureManagement;
    }
}
