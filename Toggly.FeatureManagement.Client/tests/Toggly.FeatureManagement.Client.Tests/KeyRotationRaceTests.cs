using System.Net;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Toggly.FeatureManagement.Client;
using Toggly.FeatureManagement.Client.Desktop;
using Xunit;
namespace ClientTests;

public class KeyRotationRaceTests
{
    [Fact]
    public async Task RotationDuringDefinitionsFetchNeverPassesNullKeysOrActivatesObsoleteResult()
    {
        using var oldKey=new SignedFixture();
        using var newKey=new SignedFixture();
        var updates=new AcknowledgedUpdates();
        var started=Signal();
        var release=Signal();
        var recovered=Signal();
        var definitions=0;
        var keyFetches=0;
        var verifier=new RecordingVerifier();
        using var http=new HttpClient(new Handler(async (request,ct)=>
        {
            if (request.RequestUri!.AbsolutePath.Contains("jwks"))
            {
                Interlocked.Increment(ref keyFetches);
                return Response(newKey.Jwks);
            }
            var call=Interlocked.Increment(ref definitions);
            if (call==2) { started.TrySetResult(); await release.Task.WaitAsync(ct); }
            return Response(call<3 ? oldKey.Envelope(call==2 ? "{\"obsolete\":true}" : "{}") : newKey.Envelope("{\"rotated\":true}"));
        }));
        await using var client=new TogglyClient(new(){AppKey="public",TrustedJwks=oldKey.Jwks,RefreshInterval=TimeSpan.FromHours(1)},http,verifier,updates:updates);
        var obsoleteActivated=false;
        client.Changed+=(_,_)=> { obsoleteActivated|=client.IsEnabled("obsolete"); if(client.IsEnabled("rotated")) recovered.TrySetResult(); };
        await client.InitializeAsync();
        var refresh=client.RefreshAsync();
        await started.Task.WaitAsync(TimeSpan.FromSeconds(3));
        await updates.SendAsync("{\"type\":\"signing-key-updated\"}");
        release.TrySetResult();
        await refresh.WaitAsync(TimeSpan.FromSeconds(3));
        await recovered.Task.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.False(verifier.ReceivedNull);
        Assert.False(obsoleteActivated);
        Assert.True(client.IsEnabled("rotated"));
        Assert.True(keyFetches>=1);
        await client.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(3));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RotationDuringKeyFetchDiscardsObsoleteKeysAndRefetchesBeforeVerification(bool retry)
    {
        using var oldKey=new SignedFixture();
        using var newKey=new SignedFixture();
        var updates=new AcknowledgedUpdates();
        var started=Signal();
        var release=Signal();
        var currentKeys=Signal();
        var recovered=Signal();
        var keyFetches=0;
        var initialized=false;
        var verifier=new RecordingVerifier();
        using var http=new HttpClient(new Handler(async (request,ct)=>
        {
            if (!request.RequestUri!.AbsolutePath.Contains("jwks"))
                return Response(initialized ? newKey.Envelope("{\"rotated\":true}") : oldKey.Envelope("{}"));
            var call=Interlocked.Increment(ref keyFetches);
            if(call==1) { started.TrySetResult(); await release.Task.WaitAsync(ct); }
            else await currentKeys.Task.WaitAsync(ct);
            return Response(call==1 ? oldKey.Jwks : newKey.Jwks);
        }));
        await using var client=new TogglyClient(new(){AppKey="public",TrustedJwks=oldKey.Jwks,RefreshInterval=TimeSpan.FromHours(1)},http,verifier,updates:updates);
        await client.InitializeAsync();
        initialized=true;
        client.Changed+=(_,_)=> { if(client.IsEnabled("rotated")) recovered.TrySetResult(); };
        if (!retry) await updates.SendAsync("{\"type\":\"signing-key-updated\"}");
        // A caller-owned refresh survives notification debounce cancellation. Exercise both
        // initial key loading and the fresh-key retry after a failed verification.
        var refresh=client.RefreshAsync();
        await started.Task.WaitAsync(TimeSpan.FromSeconds(3));
        await updates.SendAsync("{\"type\":\"signing-key-updated\"}");
        var verifiedBeforeRelease=verifier.Calls;
        release.TrySetResult();
        try
        {
            await refresh.WaitAsync(TimeSpan.FromSeconds(3));
            Assert.Equal(verifiedBeforeRelease,verifier.Calls);
            Assert.False(client.IsEnabled("rotated"));
        }
        finally { currentKeys.TrySetResult(); }
        await recovered.Task.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.False(verifier.ReceivedNull);
        Assert.Equal(2,keyFetches);
        Assert.True(client.IsEnabled("rotated"));
    }

    private static TaskCompletionSource Signal()=>new(TaskCreationOptions.RunContinuationsAsynchronously);
    private static HttpResponseMessage Response(string body)=>new(HttpStatusCode.OK){Content=new StringContent(body)};
    private sealed class RecordingVerifier : ISignatureVerifier
    {
        private readonly Es256SignatureVerifier verifier=new();
        public bool ReceivedNull;
        public int Calls;
        public ValueTask<bool> VerifyAsync(string definitionsJson,long timestamp,string signature,string keyId,string jwksJson,CancellationToken cancellationToken=default)
        {
            Interlocked.Increment(ref Calls);
            ReceivedNull|=jwksJson is null;
            if (jwksJson is null) return ValueTask.FromResult(false);
            return verifier.VerifyAsync(definitionsJson,timestamp,signature,keyId,jwksJson,cancellationToken);
        }
    }
    private sealed class AcknowledgedUpdates : IUpdateSource
    {
        private readonly Channel<(string Message,TaskCompletionSource Processed)> messages=Channel.CreateUnbounded<(string,TaskCompletionSource)>();
        public async Task SendAsync(string message)
        {
            var processed=Signal();
            await messages.Writer.WriteAsync((message,processed));
            await processed.Task.WaitAsync(TimeSpan.FromSeconds(3));
        }
        public async IAsyncEnumerable<string> ListenAsync(Uri uri,[EnumeratorCancellation] CancellationToken cancellationToken=default)
        {
            await foreach(var item in messages.Reader.ReadAllAsync(cancellationToken))
            {
                yield return item.Message;
                item.Processed.TrySetResult();
            }
        }
    }
}
