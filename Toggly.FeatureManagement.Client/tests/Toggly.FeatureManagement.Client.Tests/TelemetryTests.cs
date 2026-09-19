using System.Text.Json;
using Toggly.FeatureManagement.Client;
using Xunit;
namespace ClientTests;

public class TelemetryTests
{
    [Fact]
    public async Task DirectChecksPreserveLocalGateAndShortCircuit()
    {
        var transport = new TelemetryCapture();
        using var http = new HttpClient();
        await using var client = new TogglyClient(new()
        {
            AppKey = "test-app", TelemetryTransport = transport,
            Defaults = new Dictionary<string, bool> { ["on"] = true, ["off"] = false },
            LocalGates = new Dictionary<string, Func<bool>> { ["on"] = () => false }
        }, http, new Verifier());
        Assert.True(client.Evaluate(["on", "off"], negate: true));
        client.RecordUsage("on");
        client.RecordView("on");
        client.IncrementCounter("orders", 2);
        client.SetGauge("cart", 3.5);
        await client.FlushTelemetryAsync();
        var json = JsonDocument.Parse(Assert.Single(transport.Bodies)).RootElement;
        Assert.Equal("[1]", json.GetProperty("f").GetProperty("on").GetProperty("disabled").GetRawText());
        Assert.False(json.GetProperty("f").TryGetProperty("off", out _));
        Assert.Equal("[0,1,1]", json.GetProperty("f").GetProperty("on").GetProperty("enabled").GetRawText());
        Assert.Equal(2, json.GetProperty("m").GetProperty("orders").GetInt32());
    }
    [Fact]
    public async Task OptionalVariantMetadataAndOwnerReplacementNeverChangeEvaluationOrRelabel()
    {
        var capture = new TelemetryCapture();
        var defs = JsonSerializer.Serialize(new {
            defs = new { flag = new { rules = new[] { new { property = "plan", op = "eq", type = "string", value = "pro" } }, variant = new { name = new[] { "invalid" } } } },
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(), kid = "test", signature = "test"
        });
        using var http = new HttpClient(new Definitions(defs));
        var options = new TogglyClientOptions { AppKey = "old", Environment = "Old", TelemetryTransport = capture, TrustedJwks = "{}", EnableLiveUpdates = false };
        var entity = new EntityContext("Account", "private", new Dictionary<string, object?> { ["plan"] = "pro" });
        var old = new TogglyClient(options, http, new Verifier()); await old.InitializeAsync();
        Assert.Empty(capture.Bodies); Assert.True(old.IsEnabled("flag", entity));
        await using var silent = new TogglyClient(options with { EnableTelemetry = false }, http, new Verifier()); await silent.InitializeAsync(); Assert.True(silent.IsEnabled("flag", entity));
        await using var replacement = new TogglyClient(options with { AppKey = "new", Environment = "New" }, http, new Verifier()); await replacement.InitializeAsync();
        Assert.False(replacement.IsEnabled("flag")); await replacement.FlushTelemetryAsync(); await old.DisposeAsync();
        Assert.Equal(2, capture.Bodies.Count);
        var documents = capture.Bodies.Select(b => JsonDocument.Parse(b).RootElement).ToArray();
        Assert.Equal("new", documents[0].GetProperty("k").GetString()); Assert.Equal("New", documents[0].GetProperty("e").GetString());
        Assert.Equal("old", documents[1].GetProperty("k").GetString()); Assert.Equal("Old", documents[1].GetProperty("e").GetString());
        Assert.Equal("[1]", documents[1].GetProperty("f").GetProperty("flag").GetProperty("enabled").GetRawText());
    }
    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task PublicFlushContainsCancellationWithoutCancellingSharedFlight(bool keepalive, bool alreadyCancelled)
    {
        var transport = new StalledTelemetry();
        using var http = new HttpClient();
        await using var client = new TogglyClient(new() { AppKey = "local", TelemetryTransport = transport,
            Defaults = new Dictionary<string, bool> { ["on"] = true } }, http, new Verifier());
        Assert.True(client.IsEnabled("on"));
        using var cancellation = new CancellationTokenSource();
        if (alreadyCancelled) cancellation.Cancel();
        var pending = keepalive ? client.FlushTelemetryAsync(true, cancellation.Token) : client.FlushTelemetryAsync(cancellation.Token);
        await transport.Started.Task.WaitAsync(TimeSpan.FromSeconds(1));
        var shared = client.FlushTelemetryAsync();
        cancellation.Cancel();
        var escaped = await Record.ExceptionAsync(() => pending).WaitAsync(TimeSpan.FromSeconds(1));
        transport.Completion.SetResult(new(202));
        await shared;
        Assert.Null(escaped);
        Assert.Equal(1, transport.Calls);
        Assert.False(transport.RequestToken.IsCancellationRequested);
        await client.FlushTelemetryAsync();
        Assert.Equal(1, transport.Calls);
    }

    private sealed class Definitions(string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new StringContent(body) });
    }

}
internal sealed class TelemetryCapture : IFrontendTelemetryTransport
{
    public List<byte[]> Bodies { get; } = [];
    public Task<FrontendTelemetryResponse> SendAsync(Uri endpoint, ReadOnlyMemory<byte> payload, bool gzip, bool keepalive, CancellationToken cancellationToken)
    {
        if (gzip)
        {
            using var input = new System.IO.Compression.GZipStream(new MemoryStream(payload.ToArray()), System.IO.Compression.CompressionMode.Decompress);
            using var output = new MemoryStream(); input.CopyTo(output); Bodies.Add(output.ToArray());
        }
        else Bodies.Add(payload.ToArray());
        return Task.FromResult(new FrontendTelemetryResponse(202));
    }
}

internal sealed class StalledTelemetry : IFrontendTelemetryTransport
{
    public int Calls;
    public CancellationToken RequestToken;
    public TaskCompletionSource Started = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource<FrontendTelemetryResponse> Completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public Task<FrontendTelemetryResponse> SendAsync(Uri endpoint, ReadOnlyMemory<byte> payload, bool gzip, bool keepalive, CancellationToken ct)
    {
        Calls++; RequestToken = ct; Started.TrySetResult(); return Completion.Task.WaitAsync(ct);
    }
}
