namespace Toggly.FeatureManagement.Client;

/// <summary>Small BCL shims so older TFMs keep the same cancel/dispose sequencing as net8+.</summary>
internal static class Compatibility
{
    public static Task CancelAsync(CancellationTokenSource source)
    {
#if NET8_0_OR_GREATER
        return source.CancelAsync();
#else
        source.Cancel();
        return Task.CompletedTask;
#endif
    }
}
