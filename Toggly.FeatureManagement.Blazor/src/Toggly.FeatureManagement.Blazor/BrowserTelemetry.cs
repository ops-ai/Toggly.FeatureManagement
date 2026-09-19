using Microsoft.JSInterop;
using Toggly.FeatureManagement.Client;

namespace Toggly.FeatureManagement.Blazor;

/// <summary>Credential-free browser transport; aggregation remains in the portable client.</summary>
public sealed class BrowserTelemetryTransport(BrowserModule module) : IFrontendTelemetryTransport
{
    public async Task<FrontendTelemetryResponse> SendAsync(Uri endpoint, ReadOnlyMemory<byte> payload, bool gzip, bool keepalive, CancellationToken cancellationToken)
    {
        var loaded = await module.GetAsync().WaitAsync(cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        var requestId = Guid.NewGuid().ToString("N");
        try
        {
            return await loaded.InvokeAsync<FrontendTelemetryResponse>("sendTelemetry", cancellationToken,
                endpoint.AbsoluteUri, payload.ToArray(), gzip, keepalive, requestId).AsTask().WaitAsync(cancellationToken);
        }
        finally
        {
            if (cancellationToken.IsCancellationRequested)
                await AbortAsync(loaded, requestId);
        }
    }
    private static async Task AbortAsync(IJSObjectReference loaded, string requestId)
    {
        try
        {
            await loaded.InvokeVoidAsync("abortTelemetry", requestId).AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        }
        catch (Exception) { }
    }

}

/// <summary>Attaches lifecycle only after browser initialization and releases its callback on disposal.</summary>
public sealed class BrowserTelemetryLifecycle(BrowserModule module) : IAsyncDisposable
{
    private readonly object sync = new();
    private DotNetObjectReference<BrowserTelemetryLifecycle>? reference;
    private IJSObjectReference? listener;
    private TogglyClient? client;
    private Task? attaching;
    private bool disposed;

    internal Task AttachAsync(TogglyClient owner)
    {
        lock (sync)
        {
            if (disposed)
                return Task.CompletedTask;
            if (attaching is not null)
                return attaching;
            client = owner;
            reference = DotNetObjectReference.Create(this);
            return attaching = AttachCoreAsync(reference);
        }
    }
    private async Task AttachCoreAsync(DotNetObjectReference<BrowserTelemetryLifecycle> callback)
    {
        await Task.Yield();
        try
        {
            var loaded = await module.GetAsync();
            lock (sync)
            {
                if (disposed)
                    return;
            }
            var attached = await loaded.InvokeAsync<IJSObjectReference>("attachTelemetry", callback);
            lock (sync)
            {
                if (!disposed)
                {
                    listener = attached;
                    return;
                }
            }
            // An import/attach may complete after teardown. Never retain or revive that listener.
            await ReleaseAsync(attached);
        }
        catch (Exception) { lock (sync) { callback.Dispose(); if (ReferenceEquals(reference, callback)) reference = null; client = null; } }
    }
    [JSInvokable]
    public Task FlushTelemetry(bool keepalive)
    {
        TogglyClient? owner;
        lock (sync)
            owner = disposed ? null : client;
        return owner?.FlushTelemetryAsync(keepalive) ?? Task.CompletedTask;
    }
    public async ValueTask DisposeAsync()
    {
        IJSObjectReference? attached;
        lock (sync)
        {
            disposed = true;
            client = null;
            attached = listener;
            listener = null;
            reference?.Dispose();
            reference = null;
        }
        if (attached is not null)
            await ReleaseAsync(attached);
    }
    private static async Task ReleaseAsync(IJSObjectReference attached)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        try
        {
            await attached.InvokeVoidAsync("dispose").AsTask().WaitAsync(deadline.Token);
            await attached.DisposeAsync().AsTask().WaitAsync(deadline.Token);
        }
        catch (Exception) { }
    }
}
