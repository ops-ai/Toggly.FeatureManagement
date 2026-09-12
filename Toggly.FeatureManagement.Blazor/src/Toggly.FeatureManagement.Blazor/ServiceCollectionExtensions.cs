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
        services.AddScoped<IFeatureSession>(sp => new BrowserFeatureSession(
            new TogglyClient(
                options(sp),
                sp.GetRequiredService<HttpClient>(),
                sp.GetRequiredService<BrowserSignatureVerifier>(),
                sp.GetRequiredService<BrowserSnapshotStore>()
            )
        ));
        return services;
    }
}
