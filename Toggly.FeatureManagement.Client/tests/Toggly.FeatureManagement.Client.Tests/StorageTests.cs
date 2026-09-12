using Xunit;
using System.Text.Json;
using Toggly.FeatureManagement.Client;
using Toggly.FeatureManagement.Client.Desktop;
namespace ClientTests;
public class StorageTests
{
    [Fact]
    public async Task VerifyIndependentWebCryptoSignerFixture()
    {
        // Generated with WebCrypto ECDSA(SHA-256) over the first SHA-256 digest,
        // matching the worker signer; the committed fixture contains no private key.
        using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "webcrypto-fixture.json")));
        var value = doc.RootElement;
        Assert.True(await new Es256SignatureVerifier().VerifyAsync(value.GetProperty("defs").GetString()!, value.GetProperty("timestamp").GetInt64(), value.GetProperty("signature").GetString()!, value.GetProperty("kid").GetString()!, value.GetProperty("jwks").GetRawText()));
    }
    [Fact]
    public async Task AtomicFilesRejectTraversalAndRoundTripEnvelopes()
    {
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        var store = new FileSnapshotStore(path);
        var key = new string('A', 64);
        try
        {
            Assert.Null(await store.LoadAsync(key));
            await store.SaveAsync(key, new(key, "signed", "v1"));
            Assert.Equal("signed", (await store.LoadAsync(key))!.Envelope);
            await store.SaveAsync(key, new(key, "changed", "v2"));
            Assert.Equal("v2", (await store.LoadAsync(key))!.Revision);
            Assert.Null(await store.LoadAsync(new string('B', 64)));
            await Assert.ThrowsAsync<ArgumentException>(() => store.LoadAsync("../x").AsTask());
            await File.WriteAllTextAsync(Path.Combine(path, key + ".json"), "invalid");
            await Assert.ThrowsAsync<JsonException>(() => store.LoadAsync(key).AsTask());
        }
        finally { if (Directory.Exists(path)) Directory.Delete(path, true); }
    }
    [Fact]
    public async Task InvalidFileNamesAndCancelledWritesAreSafe()
    {
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        var store = new FileSnapshotStore(path);
        var key = new string('A', 64);
        try
        {
            await Assert.ThrowsAsync<ArgumentException>(() => store.LoadAsync(new string('Z', 64)).AsTask());
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => store.SaveAsync(key, new(key, "{}", null), new CancellationToken(true)).AsTask());
            Assert.Empty(Directory.GetFiles(path));
            using var http = new HttpClient();
            await using var client = DesktopClient.Create(new(), http, path);
            await client.InitializeAsync();
        }
        finally { if (Directory.Exists(path)) Directory.Delete(path, true); }
    }
    [Fact]
    public async Task DesktopFactorySuppliesNativeVerifier()
    {
        using var http = new HttpClient();
        await using var client = DesktopClient.Create(new()
        {
            Defaults = new Dictionary<string, bool> { { "yes", true } }
        }, http);
        await client.InitializeAsync();
        Assert.True(client.IsEnabled("yes"));
    }
    [Theory]
    [InlineData("{}")]
    [InlineData("{\"keys\":[]}")]
    [InlineData("invalid")]
    public async Task RejectInvalidJwks(string jwks)
    {
        Assert.False(await new Es256SignatureVerifier().VerifyAsync("{}", 1, "invalid", "key", jwks));
    }
    [Fact]
    public async Task RejectWrongAlgorithmFingerprintAndSignatureEncoding()
    {
        using var fixture = new SignedFixture();
        var verifier = new Es256SignatureVerifier();
        foreach (var jwks in new[] { fixture.Jwks.Replace("\"alg\":\"ES256\"", "\"alg\":\"ES512\""), fixture.Jwks.Replace("P-256", "P-384"), fixture.Jwks.Replace("EC", "RSA"), fixture.Jwks.Replace(fixture.Kid, "fake") })
            Assert.False(await verifier.VerifyAsync("{}", 1, "invalid", fixture.Kid, jwks));
        var node = System.Text.Json.Nodes.JsonNode.Parse(fixture.Jwks)!;
        node["keys"]![0]!["x"] = "AA==";
        Assert.False(await verifier.VerifyAsync("{}", 1, "AA==", fixture.Kid, node.ToJsonString()));
        node = System.Text.Json.Nodes.JsonNode.Parse(fixture.Jwks)!;
        node["keys"]![0]!["y"] = "AA==";
        Assert.False(await verifier.VerifyAsync("{}", 1, "AA==", fixture.Kid, node.ToJsonString()));
        Assert.False(await verifier.VerifyAsync("{}", 1, "AA==", "forged", fixture.Jwks.Replace(fixture.Kid, "forged")));
        Assert.False(await verifier.VerifyAsync("{}", 1, "@@", fixture.Kid, fixture.Jwks));
        await Assert.ThrowsAsync<OperationCanceledException>(() => verifier.VerifyAsync("{}", 1, "", fixture.Kid, fixture.Jwks, new CancellationToken(true)).AsTask());
    }
}
