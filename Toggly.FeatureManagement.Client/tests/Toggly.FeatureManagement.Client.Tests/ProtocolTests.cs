using Xunit;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Toggly.FeatureManagement.Client;
using Toggly.FeatureManagement.Client.Desktop;
namespace ClientTests;
internal sealed class SignedFixture : IDisposable
{
    public readonly ECDsa Key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    public string Kid
    {
        get;
    }

    public string Jwks
    {
        get;
    }

    public SignedFixture()
    {
        var p = Key.ExportParameters(false);
        Kid = Convert.ToHexString(SHA1.HashData(p.Q.X!.Concat(p.Q.Y!).ToArray())) + "ES256";
        Jwks = JsonSerializer.Serialize(new
        {
            keys = new[] { new { kty = "EC", crv = "P-256", alg = "ES256", kid = Kid, x = Convert.ToBase64String(p.Q.X!), y = Convert.ToBase64String(p.Q.Y!) } }
        });
    }

    public string Envelope(string defs, long? timestamp = null, bool der = false)
    {
        var time = timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var digest = SHA256.HashData(SHA256.HashData(Encoding.UTF8.GetBytes(defs + "|" + time)));
        var signature = Convert.ToBase64String(Key.SignHash(digest, der ? DSASignatureFormat.Rfc3279DerSequence : DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
        return "{\"defs\":" + defs + ",\"timestamp\":" + time + ",\"signature\":\"" + signature + "\",\"kid\":\"" + Kid + "\"}";
    }

    public void Dispose() => Key.Dispose();
}
internal sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => respond(request, cancellationToken);
}
internal sealed class Store : ISnapshotStore
{
    public Dictionary<string, ClientSnapshot> Values = [];
    public ValueTask<ClientSnapshot?> LoadAsync(string key, CancellationToken ct = default) => ValueTask.FromResult(Values.GetValueOrDefault(key));
    public ValueTask SaveAsync(string key, ClientSnapshot value, CancellationToken ct = default)
    {
        Values[key] = value;
        return ValueTask.CompletedTask;
    }
}
public class ProtocolTests
{
    private static HttpResponseMessage Response(string body, HttpStatusCode code = HttpStatusCode.OK)
    {
        var response = new HttpResponseMessage(code) { Content = new StringContent(body) };
        response.Headers.TryAddWithoutValidation("X-Definitions-Revision", "revision-1");
        return response;
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task VerifyExactBytesAndRejectTampering(bool der)
    {
        using var fixture = new SignedFixture();
        var raw = "{ \"on\": true }".Replace("\\\"", "\"");
        raw = "{ \"on\": true }";
        using var envelope = JsonDocument.Parse(fixture.Envelope(raw, der: der));
        var root = envelope.RootElement;
        var verifier = new Es256SignatureVerifier();
        Assert.True(await verifier.VerifyAsync(raw, root.GetProperty("timestamp").GetInt64(), root.GetProperty("signature").GetString()!, fixture.Kid, fixture.Jwks));
        Assert.False(await verifier.VerifyAsync(raw.Replace("true", "false"), root.GetProperty("timestamp").GetInt64(), root.GetProperty("signature").GetString()!, fixture.Kid, fixture.Jwks));
    }
    [Fact]
    public async Task ContextRequestsClearRevisionAndPersistSeparateSignedSnapshots()
    {
        using var fixture = new SignedFixture();
        var requests = new List<(string, string?)>();
        var store = new Store();
        using var http = new HttpClient(new Handler((request, ct) => { requests.Add((request.RequestUri!.ToString(), request.Headers.TryGetValues("If-None-Match", out var v) ? v.First() : null)); return Task.FromResult(Response(fixture.Envelope("{\"on\":true}"))); }));
        await using var client = new TogglyClient(new()
        {
            AppKey = "public",
            TrustedJwks = fixture.Jwks,
            EnableLiveUpdates = false
        }, http, new Es256SignatureVerifier(), store);
        var changes = 0;
        client.Changed += (_, _) => changes++;
        client.Changed += (_, _) => throw new Exception("consumer");
        client.Error += (_, _) => throw new Exception("consumer error");
        await client.InitializeAsync();
        Assert.True(client.IsEnabled("on"));
        await client.RefreshAsync();
        Assert.Equal("revision-1", requests[1].Item2);
        await client.SetContextAsync(new("alice", ["beta"], new Dictionary<string, string> { { "role", "admin" } }));
        Assert.Contains("u=alice", requests[2].Item1);
        Assert.Contains("g=beta", requests[2].Item1);
        Assert.Contains("claim.role=admin", requests[2].Item1);
        Assert.Null(requests[2].Item2);
        Assert.Equal(2, store.Values.Count);
        Assert.True(changes >= 3);
    }
    [Fact]
    public async Task InvalidSignaturePreservesLastGoodAnd304DoesNotClearIt()
    {
        using var fixture = new SignedFixture();
        var body = fixture.Envelope("{\"on\":true}");
        var status = HttpStatusCode.OK;
        using var http = new HttpClient(new Handler((request, ct) => Task.FromResult(Response(body, status))));
        await using var client = new TogglyClient(new()
        {
            AppKey = "public",
            TrustedJwks = fixture.Jwks,
            EnableLiveUpdates = false
        }, http, new Es256SignatureVerifier());
        var errors = 0;
        client.Error += (_, _) => errors++;
        await client.InitializeAsync();
        body = body.Replace("true", "false");
        await client.RefreshAsync();
        Assert.True(client.IsEnabled("on"));
        Assert.Equal(1, errors);
        status = HttpStatusCode.NotModified;
        await client.RefreshAsync();
        Assert.True(client.IsEnabled("on"));
        status = HttpStatusCode.InternalServerError;
        await client.RefreshAsync();
        Assert.True(client.IsEnabled("on"));
        Assert.Equal(2, errors);
    }
    [Fact]
    public async Task OldInflightResponseCannotRestorePreviousIdentity()
    {
        using var fixture = new SignedFixture();
        var started = new TaskCompletionSource();
        var release = new TaskCompletionSource();
        var calls = 0;
        using var http = new HttpClient(new Handler(async (request, ct) => { if (++calls == 1) { started.SetResult(); await release.Task; } return Response(fixture.Envelope(request.RequestUri!.Query.Contains("u=bob") ? "{\"on\":false}" : "{\"on\":true}")); }));
        await using var client = new TogglyClient(new()
        {
            AppKey = "public",
            TrustedJwks = fixture.Jwks,
            EnableLiveUpdates = false
        }, http, new Es256SignatureVerifier());
        var init = client.InitializeAsync();
        await started.Task;
        var context = client.SetContextAsync(new("bob"));
        Assert.False(client.IsEnabled("on"));
        release.SetResult();
        await Task.WhenAll(init, context);
        Assert.False(client.IsEnabled("on"));
    }
    [Fact]
    public async Task PersistedSnapshotsRequireTrustedKeysAndAreReverified()
    {
        using var fixture = new SignedFixture();
        var store = new Store();
        using var online = new HttpClient(new Handler((request, ct) => Task.FromResult(Response(fixture.Envelope("{\"on\":true}")))));
        var options = new TogglyClientOptions { AppKey = "public", TrustedJwks = fixture.Jwks, EnableLiveUpdates = false };
        await using (var client = new TogglyClient(options, online, new Es256SignatureVerifier(), store))
            await client.InitializeAsync();
        using var offline = new HttpClient(new Handler((request, ct) => throw new HttpRequestException("offline")));
        await using (var client = new TogglyClient(options, offline, new Es256SignatureVerifier(), store))
        {
            await client.InitializeAsync();
            Assert.True(client.IsEnabled("on"));
        }
        var key = store.Values.Keys.Single();
        store.Values[key] = store.Values[key] with
        {
            Envelope = store.Values[key].Envelope.Replace("true", "false")
        };
        await using (var client = new TogglyClient(options, offline, new Es256SignatureVerifier(), store))
        {
            await client.InitializeAsync();
            Assert.False(client.IsEnabled("on"));
        }
    }
    [Theory]
    [InlineData(-3000000)]
    [InlineData(1000)]
    public async Task RejectExpiredAndFutureEnvelopes(long offset)
    {
        using var fixture = new SignedFixture();
        using var http = new HttpClient(new Handler((r, c) => Task.FromResult(Response(fixture.Envelope("{\"on\":true}", DateTimeOffset.UtcNow.ToUnixTimeSeconds() + offset)))));
        await using var client = new TogglyClient(new()
        {
            AppKey = "public",
            TrustedJwks = fixture.Jwks,
            EnableLiveUpdates = false
        }, http, new Es256SignatureVerifier());
        var errors = 0;
        client.Error += (_, _) => errors++;
        await client.InitializeAsync();
        Assert.False(client.IsEnabled("on"));
        Assert.Equal(1, errors);
    }
    [Fact]
    public async Task JwksFetchAndAllowedKeysAreEnforced()
    {
        using var fixture = new SignedFixture();
        var count = 0;
        using var http = new HttpClient(new Handler((r, c) => { count++; return Task.FromResult(Response(r.RequestUri!.AbsolutePath.Contains("jwks") ? fixture.Jwks : fixture.Envelope("{\"on\":true}"))); }));
        await using var client = new TogglyClient(new()
        {
            AppKey = "public",
            AllowedKeyIds = ["untrusted"],
            EnableLiveUpdates = false
        }, http, new Es256SignatureVerifier());
        await client.InitializeAsync();
        Assert.False(client.IsEnabled("on"));
        Assert.Equal(2, count);
    }
    [Fact]
    public async Task CancellationAndDisposalStopRequests()
    {
        var started = new TaskCompletionSource();
        using var http = new HttpClient(new Handler(async (r, c) => { started.SetResult(); await Task.Delay(Timeout.Infinite, c); return Response(""); }));
        var client = new TogglyClient(new()
        {
            AppKey = "public",
            EnableLiveUpdates = false
        }, http, new Es256SignatureVerifier());
        var init = client.InitializeAsync();
        await started.Task;
        await client.DisposeAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => init);
        Assert.Throws<ObjectDisposedException>(() => client.IsEnabled("x"));
        await client.DisposeAsync();
    }
}
