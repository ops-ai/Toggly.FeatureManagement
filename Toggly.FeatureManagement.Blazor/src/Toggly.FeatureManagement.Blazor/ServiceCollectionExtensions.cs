using Microsoft.Extensions.DependencyInjection;
using Toggly.FeatureManagement.Client;

namespace Toggly.FeatureManagement.Blazor;

public static class ServiceCollectionExtensions
{
    /// <summary>Register in WebAssembly only. AppKey must be an additional Front-end App Key.</summary>
    public static IServiceCollection AddTogglyBlazorWebAssembly(
        this IServiceCollection services,
        Func<IServiceProvider, TogglyClientOptions> options
    )
    {
        ArgumentNullException.ThrowIfNull(options);
        services.AddScoped<BrowserModule>();
        services.AddScoped<BrowserSignatureVerifier>();
        services.AddScoped<BrowserSnapshotStore>();
        services.AddScoped<BrowserTelemetryTransport>();
        services.AddScoped<BrowserTelemetryLifecycle>();
        services.AddScoped<IFeatureSession>(sp =>
        {
            var configured = options(sp);
            // A prerender/server host cannot accidentally create frontend telemetry.
            var enabled = OperatingSystem.IsBrowser() && configured.EnableTelemetry && !string.IsNullOrWhiteSpace(configured.AppKey);
            var client = new TogglyClient(configured with
            {
                EnableTelemetry = enabled,
                TelemetryTransport = sp.GetRequiredService<BrowserTelemetryTransport>()
            }, sp.GetRequiredService<HttpClient>(), sp.GetRequiredService<BrowserSignatureVerifier>(), sp.GetRequiredService<BrowserSnapshotStore>());
            return enabled ? new BrowserFeatureSession(client, sp.GetRequiredService<BrowserTelemetryLifecycle>()) : new BrowserFeatureSession(client);
        });
        return services;
    }
}
