using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace Toggly.FeatureManagement.Client;

/// <summary>One user session. Supply a separate client for independent users.</summary>
public sealed class TogglyClient : IAsyncDisposable
{
    private readonly TogglyClientOptions options;
    private readonly HttpClient http;
    private readonly ISignatureVerifier verifier;
    private readonly ISnapshotStore? store;
    private readonly IUpdateSource updates;
    private readonly SemaphoreSlim refreshLock = new(1,1);
    private readonly SemaphoreSlim initializeLock = new(1,1);
    private readonly CancellationTokenSource lifetime = new();
    private readonly object stateLock = new();
    private Dictionary<string,JsonElement> definitions = [];
    private EvaluationContext context;
    private string? revision, jwks;
    private long generation, timestamp;
    private bool disposed, initialized;
    private Task? pollTask, liveTask;
    public bool IsReady { get; private set; }
    public event EventHandler? Changed;
    public event EventHandler<Exception>? Error;

    public TogglyClient(TogglyClientOptions options, HttpClient http, ISignatureVerifier verifier, ISnapshotStore? store = null, IUpdateSource? updates = null)
    {
        ArgumentNullException.ThrowIfNull(options); ArgumentNullException.ThrowIfNull(http); ArgumentNullException.ThrowIfNull(verifier);
        if (options.RefreshInterval <= TimeSpan.Zero || options.MaximumSignatureAge <= TimeSpan.Zero || !options.BaseUri.IsAbsoluteUri || options.BaseUri.Scheme != "https" || options.WebSocketBaseUri.Scheme != "wss") throw new ArgumentException("Use HTTPS/WSS endpoints and positive intervals.",nameof(options));
        this.options = options with { Defaults = new Dictionary<string,bool>(options.Defaults), LocalGates = new Dictionary<string,Func<bool>>(options.LocalGates), AllowedKeyIds = options.AllowedKeyIds.ToArray() };
        this.http=http; this.verifier=verifier; this.store=store; this.updates=updates ?? new WebSocketUpdates();
        context=Copy(options.Context); jwks=options.TrustedJwks;
    }
    private static EvaluationContext Copy(EvaluationContext value) => new(value.Identity, value.Groups?.Distinct().Order(StringComparer.Ordinal).ToArray(), value.Claims?.OrderBy(p=>p.Key,StringComparer.Ordinal).Take(20).ToDictionary(p=>p.Key,p=>p.Value));
    private string ContextKey(EvaluationContext value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { Base = options.BaseUri.AbsoluteUri, options.AppKey, options.Environment, Context = value }))));
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await initializeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            lock(stateLock) { ObjectDisposedException.ThrowIf(disposed,this); if(initialized) return; }
            await RefreshAsync(cancellationToken).ConfigureAwait(false);
            lock(stateLock)
            {
                if(disposed) return;
                initialized=true; IsReady=true;
                if(!string.IsNullOrWhiteSpace(options.AppKey)) { pollTask=PollAsync(lifetime.Token); if(options.EnableLiveUpdates) liveTask=LiveAsync(lifetime.Token); }
            }
        }
        finally { initializeLock.Release(); }
    }
    public bool IsEnabled(string featureKey, EntityContext? entity = null)
    {
        bool enabled;
        lock(stateLock) { ObjectDisposedException.ThrowIf(disposed,this); enabled=definitions.TryGetValue(featureKey,out var value) ? EntityEvaluator.Resolve(value,entity) : options.Defaults.GetValueOrDefault(featureKey); }
        if(!enabled || !options.LocalGates.TryGetValue(featureKey,out var gate)) return enabled;
        try { return gate(); } catch(Exception ex) { Report(ex); return false; }
    }
    public bool Evaluate(IEnumerable<string> featureKeys, Requirement requirement = Requirement.All, bool negate = false, EntityContext? entity = null)
    {
        var keys=featureKeys.ToArray(); var result=keys.Length==0 || (requirement==Requirement.Any ? keys.Any(k=>IsEnabled(k,entity)) : keys.All(k=>IsEnabled(k,entity)));
        return negate ? !result : result;
    }
    public async Task SetContextAsync(EvaluationContext value, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(value);
        lock(stateLock) { ObjectDisposedException.ThrowIf(disposed,this); context=Copy(value); generation++; definitions=[]; revision=null; timestamp=0; }
        Notify(); await RefreshAsync(cancellationToken).ConfigureAwait(false);
    }
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        using var linked=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken,lifetime.Token);
        var ct=linked.Token;
        await refreshLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            EvaluationContext current; long version;
            lock(stateLock) { ObjectDisposedException.ThrowIf(disposed,this); current=context; version=generation; }
            if(string.IsNullOrWhiteSpace(options.AppKey)) return;
            var key=ContextKey(current);
            try
            {
                if(jwks is null) jwks=await FetchKeysAsync(ct).ConfigureAwait(false);
                if(store is not null && timestamp==0)
                {
                    try
                    {
                        var snapshot=await store.LoadAsync(key,ct).ConfigureAwait(false);
                        if(snapshot is not null && snapshot.ContextKey==key) await AcceptAsync(snapshot.Envelope,snapshot.Revision,version,ct).ConfigureAwait(false);
                    }
                    catch(Exception ex) when(ex is not OperationCanceledException) { Report(ex); }
                }
                var query=new List<string>();
                if(current.Identity is not null) query.Add("u="+Uri.EscapeDataString(current.Identity));
                foreach(var group in current.Groups ?? []) query.Add("g="+Uri.EscapeDataString(group));
                foreach(var claim in current.Claims ?? new Dictionary<string,string>()) query.Add("claim."+Uri.EscapeDataString(claim.Key)+"="+Uri.EscapeDataString(claim.Value));
                var path=$"evaluated-signed/{Uri.EscapeDataString(options.AppKey)}/{Uri.EscapeDataString(options.Environment)}";
                using var request=new HttpRequestMessage(HttpMethod.Get,new Uri(options.BaseUri,path+"?"+string.Join("&",query)));
                string? rev; lock(stateLock) rev=revision;
                if(rev is not null) request.Headers.TryAddWithoutValidation("If-None-Match",rev);
                request.Headers.Add("X-Toggly-Sdk","dotnet-client"); request.Headers.Add("X-Toggly-Sdk-Version","0.1.0");
                using var response=await http.SendAsync(request,ct).ConfigureAwait(false);
                if(response.StatusCode==HttpStatusCode.NotModified) return;
                response.EnsureSuccessStatusCode();
                var body=await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                var nextRevision=response.Headers.TryGetValues("X-Definitions-Revision",out var values) ? values.FirstOrDefault() : response.Headers.ETag?.ToString();
                if(await AcceptAsync(body,nextRevision,version,ct).ConfigureAwait(false) && store is not null) await store.SaveAsync(key,new(key,body,nextRevision),ct).ConfigureAwait(false);
            }
            catch(Exception ex) when(ex is not OperationCanceledException) { Report(ex); }
        }
        finally { refreshLock.Release(); }
    }
    private async Task<string> FetchKeysAsync(CancellationToken ct) => await http.GetStringAsync(new Uri(options.BaseUri,".well-known/jwks"),ct).ConfigureAwait(false);
    private async Task<bool> AcceptAsync(string body,string? rev,long version,CancellationToken ct)
    {
        using var document=JsonDocument.Parse(body); var root=document.RootElement;
        if(root.EnumerateObject().Select(p=>p.Name).Distinct(StringComparer.Ordinal).Count()!=root.EnumerateObject().Count()) throw new JsonException("Duplicate envelope properties.");
        var defs=root.GetProperty("defs"); var time=root.GetProperty("timestamp").GetInt64(); var kid=root.GetProperty("kid").GetString()!;
        var now=DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if(time>now+300 || time<now-options.MaximumSignatureAge.TotalSeconds || time<timestamp) throw new CryptographicException("Stale signature.");
        if(options.AllowedKeyIds.Count>0 && !options.AllowedKeyIds.Contains(kid)) throw new CryptographicException("Signing key is not allowed.");
        var signature=root.GetProperty("signature").GetString()!;
        if(!await verifier.VerifyAsync(defs.GetRawText(),time,signature,kid,jwks!,ct).ConfigureAwait(false))
        {
            // A client may miss a signing-key WebSocket notification while offline.
            // Retry against fresh trusted endpoint keys once; never trust keys in a snapshot.
            jwks=await FetchKeysAsync(ct).ConfigureAwait(false);
            if(!await verifier.VerifyAsync(defs.GetRawText(),time,signature,kid,jwks,ct).ConfigureAwait(false)) throw new CryptographicException("Invalid signature.");
        }
        var next=defs.EnumerateObject().ToDictionary(p=>p.Name,p=>p.Value.Clone(),StringComparer.Ordinal);
        if(next.Values.Any(v=>v.ValueKind is not (JsonValueKind.True or JsonValueKind.False or JsonValueKind.Object))) throw new JsonException("Invalid definition.");
        lock(stateLock) { if(disposed || version!=generation) return false; definitions=next; revision=rev; timestamp=time; }
        Notify(); return true;
    }
    private void Notify() { foreach(EventHandler handler in Changed?.GetInvocationList() ?? []) { try { handler(this,EventArgs.Empty); } catch(Exception ex) { Report(ex); } } }
    private void Report(Exception ex) { foreach(EventHandler<Exception> handler in Error?.GetInvocationList() ?? []) { try { handler(this,ex); } catch { /* Consumer errors must not kill refresh. */ } } }
    private async Task PollAsync(CancellationToken ct)
    {
        try { while(true) { await Task.Delay(options.RefreshInterval,ct).ConfigureAwait(false); await RefreshAsync(ct).ConfigureAwait(false); } }
        catch(OperationCanceledException) when(ct.IsCancellationRequested) { }
    }
    private async Task LiveAsync(CancellationToken ct)
    {
        var backoff=TimeSpan.FromSeconds(5);
        CancellationTokenSource? debounce=null; Task pending=Task.CompletedTask;
        while(!ct.IsCancellationRequested)
        {
            try
            {
                string? rev; lock(stateLock) rev=revision;
                var uri=new Uri(options.WebSocketBaseUri,$"{Uri.EscapeDataString(options.AppKey!)}/{Uri.EscapeDataString(options.Environment)}/ws?sdk=dotnet-client&sdkVersion=0.1.0"+(rev is null?"":"&rev="+Uri.EscapeDataString(rev)));
                await foreach(var message in updates.ListenAsync(uri,ct).ConfigureAwait(false))
                {
                    backoff=TimeSpan.FromSeconds(5);
                    try
                    {
                        using var doc=JsonDocument.Parse(message); var root=doc.RootElement;
                        var type=root.GetProperty("type").GetString();
                        if(type is not ("sync" or "flags-updated" or "signing-key-updated")) continue;
                        if(type=="signing-key-updated") { jwks=null; lock(stateLock) revision=null; }
                        else { var etag=root.TryGetProperty("etag",out var tag)?tag.GetString():null; lock(stateLock) { if(revision is not null && ((etag is not null && etag==revision) || (root.TryGetProperty("unchanged",out var unchanged) && unchanged.ValueKind==JsonValueKind.True))) continue; } }
                        debounce?.Cancel(); debounce?.Dispose(); debounce=CancellationTokenSource.CreateLinkedTokenSource(ct);
                        pending=DebouncedRefreshAsync(debounce.Token);
                    }
                    catch(Exception ex) when(ex is not OperationCanceledException) { Report(ex); }
                }
            }
            catch(Exception ex) when(ex is not OperationCanceledException) { Report(ex); }
            catch(OperationCanceledException) when(ct.IsCancellationRequested) { break; }
            try { await Task.Delay(backoff,ct).ConfigureAwait(false); } catch(OperationCanceledException) when(ct.IsCancellationRequested) { break; }
            backoff=TimeSpan.FromSeconds(Math.Min(60,backoff.TotalSeconds*2));
        }
        debounce?.Cancel(); await pending.ConfigureAwait(false); debounce?.Dispose();
    }
    private async Task DebouncedRefreshAsync(CancellationToken ct)
    {
        try { await Task.Delay(300,ct).ConfigureAwait(false); await RefreshAsync(ct).ConfigureAwait(false); }
        catch(OperationCanceledException) when(ct.IsCancellationRequested) { }
    }
    public async ValueTask DisposeAsync()
    {
        lock(stateLock) { if(disposed) return; disposed=true; generation++; }
        await lifetime.CancelAsync().ConfigureAwait(false);
        await Task.WhenAll(pollTask ?? Task.CompletedTask,liveTask ?? Task.CompletedTask).ConfigureAwait(false);
        await refreshLock.WaitAsync().ConfigureAwait(false); refreshLock.Release();
        Changed=null; Error=null; lifetime.Dispose();
    }
}
