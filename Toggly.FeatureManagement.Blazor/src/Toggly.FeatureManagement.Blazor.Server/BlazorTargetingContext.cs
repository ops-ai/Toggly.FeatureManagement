using Microsoft.FeatureManagement.FeatureFilters;
using Toggly.FeatureManagement.Client;

namespace Toggly.FeatureManagement.Blazor.Server;

/// <summary>Singleton accessor with immutable async-flow-local values, never mutable circuit identity.</summary>
public sealed class BlazorTargetingContext : ITargetingContextAccessor
{
    private static readonly AsyncLocal<EvaluationContext?> current = new();
    public static EvaluationContext Current => current.Value ?? new();

    internal static IDisposable Enter(EvaluationContext context)
    {
        var previous = current.Value;
        current.Value = context;
        return new Restore(() => current.Value = previous);
    }

    public ValueTask<TargetingContext> GetContextAsync() =>
        ValueTask.FromResult(
            new TargetingContext { UserId = Current.Identity, Groups = Current.Groups ?? [] }
        );

    private sealed class Restore(Action action) : IDisposable
    {
        public void Dispose() => action();
    }
}
