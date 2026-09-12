using System.Text.Json;
namespace Toggly.FeatureManagement.Client;

public sealed partial class TogglyClient
{
    private async Task LiveAsync(CancellationToken ct)
    {
        var backoff=TimeSpan.FromSeconds(5);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await ListenForUpdatesAsync(()=>backoff=TimeSpan.FromSeconds(5),ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { Report(ex); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            try { await Task.Delay(backoff,ct).ConfigureAwait(false); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            backoff=TimeSpan.FromSeconds(Math.Min(60,backoff.TotalSeconds*2));
        }
    }
    private Uri UpdateUri()
    {
        string? rev;
        lock (stateLock) rev=revision;
        var path=$"{Uri.EscapeDataString(options.AppKey!)}/{Uri.EscapeDataString(options.Environment)}/ws?sdk=dotnet-client&sdkVersion=0.1.0";
        if (rev is not null) path+="&rev="+Uri.EscapeDataString(rev);
        return new Uri(options.WebSocketBaseUri,path);
    }
    private async Task ListenForUpdatesAsync(Action received,CancellationToken ct)
    {
        CancellationTokenSource? debounce=null;
        Task pending=Task.CompletedTask;
        try
        {
            await foreach (var message in updates.ListenAsync(UpdateUri(),ct).ConfigureAwait(false))
            {
                received();
                if (!InvalidateFromMessage(message)) continue;
                // Cancel and observe every superseded refresh before disposing its token source.
                await CancelPendingAsync(debounce,pending).ConfigureAwait(false);
                debounce=CancellationTokenSource.CreateLinkedTokenSource(ct);
                pending=DebouncedRefreshAsync(debounce.Token);
            }
        }
        finally { await CancelPendingAsync(debounce,pending).ConfigureAwait(false); }
    }
    private static async Task CancelPendingAsync(CancellationTokenSource? debounce,Task pending)
    {
        if (debounce is null) return;
        try
        {
            await debounce.CancelAsync().ConfigureAwait(false);
            await pending.ConfigureAwait(false);
        }
        finally { debounce.Dispose(); }
    }
    private bool InvalidateFromMessage(string message)
    {
        try
        {
            if (message is "update" or "flags-updated") return Invalidate("update",null,false);
            using var doc=JsonDocument.Parse(message);
            var root=doc.RootElement;
            var type=root.GetProperty("type").GetString();
            var etag=root.TryGetProperty("etag",out var tag) ? tag.GetString() : null;
            var unchanged=root.TryGetProperty("unchanged",out var value) && value.ValueKind==JsonValueKind.True;
            return Invalidate(type,etag,unchanged);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or KeyNotFoundException)
        {
            Report(ex);
            return false;
        }
    }
    private bool Invalidate(string? type,string? etag,bool unchanged)
    {
        if (type is not ("sync" or "update" or "flags-updated" or "signing-key-updated")) return false;
        lock (stateLock)
        {
            if (type=="sync" && unchanged) return false;
            if (type!="signing-key-updated" && etag is not null && etag==revision) return false;
            if (type=="signing-key-updated") jwks=null;
            generation++;
            invalidated=true;
            requestedRevision=etag;
            // No conditional cache state is valid after an unversioned invalidation.
            revision=null;
            return true;
        }
    }
    private async Task DebouncedRefreshAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(300,ct).ConfigureAwait(false);
            await RefreshAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Debounce replacement and client disposal deliberately cancel pending refreshes.
        }
    }
}
