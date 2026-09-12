using Microsoft.AspNetCore.Components.Server.Circuits;
using Microsoft.Extensions.DependencyInjection;
using Toggly.FeatureManagement.Configuration;

namespace Toggly.FeatureManagement.Blazor.Server;

public static class ServiceCollectionExtensions
{
    /// <summary>Call after AddToggly (or register an IFeatureManager for offline definitions).</summary>
    public static IServiceCollection AddTogglyBlazorServer(this IServiceCollection services)
    {
        services.AddTogglyFeatureManagement().WithTogglyTargeting<BlazorTargetingContext>();
        services.AddScoped<IFeatureSession, ServerFeatureSession>();
        services.AddScoped<CircuitHandler, FeatureCircuitHandler>();
        return services;
    }
}

/// <summary>A resumed circuit re-evaluates its own cached context against current definitions.</summary>
public sealed class FeatureCircuitHandler(IFeatureSession session) : CircuitHandler
{
    public override Task OnConnectionUpAsync(
        Circuit circuit,
        CancellationToken cancellationToken
    ) => session.RefreshAsync(cancellationToken);
}
