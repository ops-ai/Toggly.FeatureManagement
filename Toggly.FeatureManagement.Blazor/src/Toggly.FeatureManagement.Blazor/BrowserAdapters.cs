using Microsoft.JSInterop;
using Toggly.FeatureManagement.Client;
namespace Toggly.FeatureManagement.Blazor;

/// <summary>Loads browser-only WebCrypto and storage through a lazily imported module.</summary>
public sealed class BrowserModule(IJSRuntime js) : IAsyncDisposable
{
    private Task<IJSObjectReference>? module;
    public Task<IJSObjectReference> GetAsync() => module ??= js.InvokeAsync<IJSObjectReference>("import", "./_content/Toggly.FeatureManagement.Blazor/toggly.js").AsTask();
    public async ValueTask DisposeAsync()
    {
        if (module is null) return;
        try { await (await module).DisposeAsync(); } catch (JSDisconnectedException) { }
    }
}
public sealed class BrowserSignatureVerifier(BrowserModule module) : ISignatureVerifier
{
    public async ValueTask<bool> VerifyAsync(string definitionsJson, long timestamp, string signature, string keyId, string jwksJson, CancellationToken cancellationToken = default)
        => await (await module.GetAsync()).InvokeAsync<bool>("verify", cancellationToken, definitionsJson, timestamp, signature, keyId, jwksJson);
}
/// <summary>Stores signed envelopes in sessionStorage; the portable core re-verifies before use.</summary>
public sealed class BrowserSnapshotStore(BrowserModule module) : ISnapshotStore
{
    public async ValueTask<ClientSnapshot?> LoadAsync(string contextKey, CancellationToken cancellationToken = default)
        => await (await module.GetAsync()).InvokeAsync<ClientSnapshot?>("load", cancellationToken, contextKey);
    public async ValueTask SaveAsync(string contextKey, ClientSnapshot snapshot, CancellationToken cancellationToken = default)
        => await (await module.GetAsync()).InvokeVoidAsync("save", cancellationToken, contextKey, snapshot);
}
