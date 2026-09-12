using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace Toggly.FeatureManagement.Client;

/// <summary>One user session. Supply a separate client for independent users.</summary>
public sealed partial class TogglyClient : IAsyncDisposable
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
    private string? revision, jwks, requestedRevision;
    private bool invalidated;
    private long generation, timestamp;
    private bool disposed, initialized;
    private Task? pollTask, liveTask;
    public bool IsReady { get; private set; }
    private EventHandler? changedHandlers;
    private EventHandler<Exception>? errorHandlers;
    public event EventHandler? Changed
    {
        add { lock (stateLock) changedHandlers += value; }
        remove { lock (stateLock) changedHandlers -= value; }
    }
    public event EventHandler<Exception>? Error
    {
        add { lock (stateLock) errorHandlers += value; }
        remove { lock (stateLock) errorHandlers -= value; }
    }

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
        lock(stateLock) { ObjectDisposedException.ThrowIf(disposed,this); context=Copy(value); generation++; definitions=[]; revision=null; timestamp=0; invalidated=false; requestedRevision=null; }
        Notify(); await RefreshAsync(cancellationToken).ConfigureAwait(false);
    }
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        using var linked=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken,lifetime.Token);
        var ct=linked.Token;
        await refreshLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            EvaluationContext current; long version; string? keys;
            lock(stateLock) { ObjectDisposedException.ThrowIf(disposed,this); current=context; version=generation; keys=jwks; }
            if(string.IsNullOrWhiteSpace(options.AppKey)) return;
            var key=ContextKey(current);
            try
            {
                // Keep this operation's immutable keys coherent with its captured generation.
                keys ??= await FetchKeysAsync(version,ct).ConfigureAwait(false);
                if (keys is null) return;
                await RestoreSnapshotAsync(key,version,keys,ct).ConfigureAwait(false);
                await FetchDefinitionsAsync(current,key,version,keys,ct).ConfigureAwait(false);
            }
            catch(Exception ex) when(ex is not OperationCanceledException) { Report(ex); }
        }
        finally { refreshLock.Release(); }
    }
    private async Task RestoreSnapshotAsync(string key,long version,string keys,CancellationToken ct)
    {
        if (store is null || timestamp != 0) return;
        try
        {
            var snapshot=await store.LoadAsync(key,ct).ConfigureAwait(false);
            if (snapshot is not null && snapshot.ContextKey==key)
                await AcceptAsync(snapshot.Envelope,snapshot.Revision,version,keys,ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException) { Report(ex); }
    }
    private HttpRequestMessage CreateRequest(EvaluationContext current)
    {
        var query=new List<string>();
        if (current.Identity is not null) query.Add("u="+Uri.EscapeDataString(current.Identity));
        foreach (var group in current.Groups ?? []) query.Add("g="+Uri.EscapeDataString(group));
        foreach (var claim in current.Claims ?? new Dictionary<string,string>())
            query.Add("claim."+Uri.EscapeDataString(claim.Key)+"="+Uri.EscapeDataString(claim.Value));
        string? conditionalRevision, pinnedRevision;
        lock (stateLock)
        {
            conditionalRevision=invalidated ? null : revision;
            pinnedRevision=requestedRevision;
        }
        // A notification revision routes the GET; only the signed HTTP response updates cached state.
        if (pinnedRevision is not null) query.Add("rev="+Uri.EscapeDataString(pinnedRevision));
        var path=$"evaluated-signed/{Uri.EscapeDataString(options.AppKey!)}/{Uri.EscapeDataString(options.Environment)}";
        var request=new HttpRequestMessage(HttpMethod.Get,new Uri(options.BaseUri,path+"?"+string.Join("&",query)));
        if (conditionalRevision is not null) request.Headers.TryAddWithoutValidation("If-None-Match",conditionalRevision);
        request.Headers.Add("X-Toggly-Sdk","dotnet-client");
        request.Headers.Add("X-Toggly-Sdk-Version","0.1.0");
        return request;
    }
    private async Task FetchDefinitionsAsync(EvaluationContext current,string key,long version,string keys,CancellationToken ct)
    {
        if (!IsCurrent(version)) return;
        using var request=CreateRequest(current);
        using var response=await http.SendAsync(request,ct).ConfigureAwait(false);
        if (response.StatusCode==HttpStatusCode.NotModified) return;
        response.EnsureSuccessStatusCode();
        var body=await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        var nextRevision=response.Headers.TryGetValues("X-Definitions-Revision",out var values)
            ? values.FirstOrDefault() : response.Headers.ETag?.ToString();
        if (await AcceptAsync(body,nextRevision,version,keys,ct).ConfigureAwait(false) && store is not null)
            await store.SaveAsync(key,new(key,body,nextRevision),ct).ConfigureAwait(false);
    }
    private async Task<string?> FetchKeysAsync(long version,CancellationToken ct)
    {
        var keys=await http.GetStringAsync(new Uri(options.BaseUri,".well-known/jwks"),ct).ConfigureAwait(false);
        lock (stateLock)
        {
            // A late key fetch must not overwrite a newer signing-key invalidation.
            if (disposed || version!=generation) return null;
            jwks=keys;
            return keys;
        }
    }
    private bool IsCurrent(long version)
    {
        lock (stateLock) return !disposed && version==generation;
    }
    private async Task<bool> AcceptAsync(string body,string? rev,long version,string keys,CancellationToken ct)
    {
        if (!IsCurrent(version)) return false;
        using var document=JsonDocument.Parse(body); var root=document.RootElement;
        if(root.EnumerateObject().Select(p=>p.Name).Distinct(StringComparer.Ordinal).Count()!=root.EnumerateObject().Count()) throw new JsonException("Duplicate envelope properties.");
        var defs=root.GetProperty("defs"); var time=root.GetProperty("timestamp").GetInt64(); var kid=root.GetProperty("kid").GetString()!;
        var now=DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if(time>now+300 || time<now-options.MaximumSignatureAge.TotalSeconds || time<timestamp) throw new CryptographicException("Stale signature.");
        if(options.AllowedKeyIds.Count>0 && !options.AllowedKeyIds.Contains(kid)) throw new CryptographicException("Signing key is not allowed.");
        var signature=root.GetProperty("signature").GetString()!;
        if(!await verifier.VerifyAsync(defs.GetRawText(),time,signature,kid,keys,ct).ConfigureAwait(false))
        {
            // A client may miss a signing-key WebSocket notification while offline.
            // Retry against fresh trusted endpoint keys once; never trust keys in a snapshot.
            var freshKeys=await FetchKeysAsync(version,ct).ConfigureAwait(false);
            if (freshKeys is null) return false;
            if(!await verifier.VerifyAsync(defs.GetRawText(),time,signature,kid,freshKeys,ct).ConfigureAwait(false)) throw new CryptographicException("Invalid signature.");
        }
        var next=defs.EnumerateObject().ToDictionary(p=>p.Name,p=>p.Value.Clone(),StringComparer.Ordinal);
        if(next.Values.Any(v=>v.ValueKind is not (JsonValueKind.True or JsonValueKind.False or JsonValueKind.Object))) throw new JsonException("Invalid definition.");
        lock (stateLock)
        {
            if (disposed || version!=generation) return false;
            definitions=next;
            revision=rev;
            timestamp=time;
            invalidated=false;
            requestedRevision=null;
        }
        Notify(); return true;
    }
    private void Notify()
    {
        EventHandler? handlers;
        lock (stateLock) handlers=changedHandlers;
        foreach (var handler in handlers?.GetInvocationList().Cast<EventHandler>() ?? [])
        {
            try { handler.Invoke(this,EventArgs.Empty); }
            catch (Exception ex) { Report(ex); }
        }
    }
    private void Report(Exception ex)
    {
        EventHandler<Exception>? handlers;
        lock (stateLock) handlers=errorHandlers;
        foreach (var handler in handlers?.GetInvocationList().Cast<EventHandler<Exception>>() ?? [])
        {
            try { handler.Invoke(this,ex); }
            catch (Exception) { /* Consumer errors must not kill refresh or prevent other subscribers running. */ }
        }
    }
    private async Task PollAsync(CancellationToken ct)
    {
        try { while(true) { await Task.Delay(options.RefreshInterval,ct).ConfigureAwait(false); await RefreshAsync(ct).ConfigureAwait(false); } }
        catch(OperationCanceledException) when(ct.IsCancellationRequested) { /* Normal lifetime shutdown. */ }
    }
    public async ValueTask DisposeAsync()
    {
        lock (stateLock)
        {
            if (disposed) return;
            disposed=true;
            generation++;
        }
        await lifetime.CancelAsync().ConfigureAwait(false);
        await Task.WhenAll(pollTask ?? Task.CompletedTask,liveTask ?? Task.CompletedTask).ConfigureAwait(false);
        // The lifetime token is already cancelled. Drain any caller-owned refresh that is still
        // unwinding so disposal cannot return while transport/store callbacks remain active.
        await refreshLock.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        refreshLock.Release();
        lock (stateLock) { changedHandlers=null; errorHandlers=null; }
        lifetime.Dispose();
    }
}
