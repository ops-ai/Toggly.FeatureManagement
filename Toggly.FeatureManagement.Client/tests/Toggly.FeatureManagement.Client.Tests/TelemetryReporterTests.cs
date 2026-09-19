using System.Text.Json;
using System.Text.Json.Nodes;
using Toggly.FeatureManagement.Client;
using Xunit;
namespace ClientTests;

public class TelemetryReporterTests
{
    private static JsonElement Contract => JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "telemetry-contract.json"))).RootElement;
    private static JsonElement Body(byte[] body) => JsonDocument.Parse(body).RootElement;
    private static TogglyClientOptions Options(IFrontendTelemetryTransport transport) => new() { AppKey = "test-app", TelemetryTransport = transport };

    [Fact]
    public async Task DiagnosticsAreOncePerFixedCodeWithoutDroppingAcceptedData()
    {
        var diagnostics = new System.Collections.Concurrent.ConcurrentBag<string>();
        var received = new List<byte[]>(); var mode = 0;
        var sender = new Sender((body, _, _) => {
            if (mode == 1) throw new IOException("private failure payload");
            if (mode == 2) return Task.FromResult(new FrontendTelemetryResponse(400));
            received.Add(body); return Task.FromResult(new FrontendTelemetryResponse(202));
        });
        await using var reporter = new FrontendTelemetryReporter(Options(sender) with {
            TelemetryFlushIntervalMs = 1,
            OnTelemetryDiagnostic = code => { diagnostics.Add(code); throw new Exception("host diagnostic failure"); }
        });
        Parallel.For(0, 10000, _ => reporter.RecordUsage("private-name", "bad\n"));
        for (var i = 0; i < 2100; i++) reporter.RecordUsage($"accepted-{i}");
        await reporter.FlushTelemetryAsync();
        Assert.Equal(2000, received.Sum(body => Body(body).GetProperty("f").EnumerateObject().Count()));
        for (var i = 0; i < 100; i++) reporter.RecordUsage(new string('x', 50000));
        reporter.IncrementCounter("metric");
        for (var i = 0; i < 100; i++) reporter.SetGauge("metric", 1);
        await reporter.FlushTelemetryAsync();
        Assert.Equal(1, Body(received.Last()).GetProperty("m").GetProperty("metric").GetInt32());
        for (mode = 1; mode <= 2; mode++)
            for (var i = 0; i < 100; i++) { reporter.RecordUsage("failed"); await reporter.FlushTelemetryAsync(); }
        Assert.Equal(new[] { "buffer-limit", "http-failure", "invalid-event", "invalid-option", "metric-kind-conflict", "oversized-entry", "transport-failure" }, diagnostics.Order().ToArray());
    }

    [Fact]
    public async Task SharedSerializationAndEndpointFixtures()
    {
        foreach (var scenario in Contract.GetProperty("scenarios").EnumerateArray())
        {
            var capture = new TelemetryCapture();
            var options = Options(capture);
            if (scenario.TryGetProperty("options", out var settings))
            {
                if (settings.TryGetProperty("appKey", out var key)) options = options with { AppKey = key.GetString() };
                if (settings.TryGetProperty("enableTelemetry", out var enabled)) options = options with { EnableTelemetry = enabled.GetBoolean() };
                if (settings.TryGetProperty("instanceId", out var instanceId)) options = options with { InstanceId = instanceId.GetString() };
                if (settings.TryGetProperty("identity", out var identity)) options = options with { Context = options.Context with { Identity = identity.GetString() } };
            }
            await using var reporter = new FrontendTelemetryReporter(options);
            foreach (var item in scenario.GetProperty("events").EnumerateArray())
            {
                var args = item.EnumerateArray().ToArray(); var key = args[1].GetString()!;
                switch (args[0].GetString())
                {
                    case "recordCheck": reporter.RecordCheck(key, args[2].GetString()!); break;
                    case "recordUsage": reporter.RecordUsage(key, args.Length > 2 ? args[2].GetString()! : "enabled"); break;
                    case "recordView": reporter.RecordView(key, args.Length > 2 ? args[2].GetString()! : "enabled"); break;
                    case "incrementCounter": reporter.IncrementCounter(key, args[2].GetDouble()); break;
                    case "setGauge": reporter.SetGauge(key, args[2].GetDouble()); break;
                    default: throw new Exception("Unknown contract event");
                }
            }
            await reporter.FlushTelemetryAsync();
            Assert.True(JsonNode.DeepEquals(JsonNode.Parse(scenario.GetProperty("envelopes").GetRawText()), new JsonArray(capture.Bodies.Select(x => JsonNode.Parse(x)).ToArray())), scenario.GetProperty("name").GetString());
        }
        foreach (var row in Contract.GetProperty("endpointScenarios").EnumerateArray())
        {
            var expected = row.GetProperty("expectedUrl").ValueKind == JsonValueKind.Null ? null : row.GetProperty("expectedUrl").GetString();
            Assert.Equal(expected, FrontendTelemetryReporter.Endpoint(row.GetProperty("metricsBaseUrl").GetString())?.AbsoluteUri);
        }
        foreach (var invalid in new[] { "https:///path", "http:////path", "https://", "http://", "https://@host.test", null }) Assert.Null(FrontendTelemetryReporter.Endpoint(invalid));
    }

    [Fact]
    public async Task SharedTransportFixtures()
    {
        foreach (var row in Contract.GetProperty("transportScenarios").EnumerateArray())
        {
            long now = 0; var attempts = new List<long>();
            var sender = new Sender(async (_, _, ct) =>
            {
                attempts.Add(now);
                if (row.TryGetProperty("failure", out var failure))
                {
                    if (failure.GetString() == "network") throw new IOException("ambiguous");
                    await Task.Delay(Timeout.Infinite, ct);
                }
                return new(row.GetProperty("statuses")[attempts.Count - 1].GetInt32(), row.TryGetProperty("retryAfter", out var retry) ? retry.GetString() : null);
            });
            await using var reporter = new FrontendTelemetryReporter(Options(sender), () => now, (ms, _) => { now += ms; return Task.CompletedTask; }, timeout: TimeSpan.FromMilliseconds(20));
            reporter.IncrementCounter("orders"); await reporter.FlushTelemetryAsync();
            Assert.Equal(row.GetProperty("attemptTimesMs").EnumerateArray().Select(x => x.GetInt64()), attempts);
        }
    }

    [Fact]
    public async Task AdmissionLimitsChunksAndNestedPacketOverflow()
    {
        var capture = new TelemetryCapture();
        await using var reporter = new FrontendTelemetryReporter(Options(capture));
        for (var i = 0; i < 2001; i++) reporter.RecordCheck($"f{i}", "enabled");
        reporter.RecordUsage(new string('x', 50000));
        await reporter.FlushTelemetryAsync();
        Assert.Equal(2000, capture.Bodies.Sum(b => Body(b).GetProperty("f").EnumerateObject().Count()));
        capture.Bodies.Clear();
        var key = new string('f', 48400);
        var variants = Enumerable.Range(0, 12).Select(i => $"v{i}".PadRight(64, 'x')).ToArray();
        foreach (var variant in variants) reporter.RecordCheck(key, variant);
        await reporter.FlushTelemetryAsync();
        Assert.Equal(2, capture.Bodies.Count);
        var received = capture.Bodies.SelectMany(b => Body(b).GetProperty("f").GetProperty(key).EnumerateObject()).ToArray();
        Assert.Equal(variants.Order(), received.Select(x => x.Name).Order()); Assert.All(received, x => Assert.Equal("[1]", x.Value.GetRawText()));
        Assert.All(capture.Bodies, b => Assert.True(b.Length <= 49152));
        capture.Bodies.Clear();
        for (var i = 0; i < 17; i++) reporter.RecordCheck("variants", $"v{i}");
        for (var i = 0; i < 4; i++) reporter.IncrementCounter("orders", 1000000);
        await reporter.FlushTelemetryAsync();
        Assert.Equal(4000000, capture.Bodies.Sum(b => Body(b).TryGetProperty("m", out var m) ? m.GetProperty("orders").GetDouble() : 0));
        Assert.All(capture.Bodies, b => { if (Body(b).TryGetProperty("f", out var f)) Assert.True(f.GetProperty("variants").EnumerateObject().Count() <= 16); });
        capture.Bodies.Clear();
        for (var i = 0; i < 20; i++) reporter.IncrementCounter(new string('m', 20000), 1000000);
        await reporter.FlushTelemetryAsync();
        Assert.InRange(capture.Bodies.Sum(b => b.Length), 1, 262144);
    }

    [Fact]
    public async Task AtomicFlushGaugeOrderingAndInflightBudget()
    {
        var started = new TaskCompletionSource(); var release = new TaskCompletionSource(); var bodies = new List<byte[]>();
        var sender = new Sender(async (b, _, _) => { bodies.Add(b); if (bodies.Count == 1) { started.SetResult(); await release.Task; } return new(202); });
        await using var reporter = new FrontendTelemetryReporter(Options(sender));
        reporter.SetGauge("cart", 1); var first = reporter.FlushTelemetryAsync(); await started.Task;
        reporter.SetGauge("cart", 2); reporter.IncrementCounter("cart", 1);
        var second = reporter.FlushTelemetryAsync(); Assert.Single(bodies); release.SetResult(); await Task.WhenAll(first, second);
        Assert.Equal(new[] { 1d, 2d }, bodies.Select(b => Body(b).GetProperty("m").GetProperty("cart").GetDouble()));
        reporter.IncrementCounter("cart"); reporter.SetGauge("cart", 3); await reporter.FlushTelemetryAsync();
        Assert.Equal(1, Body(bodies.Last()).GetProperty("m").GetProperty("cart").GetDouble());
    }

    [Fact]
    public async Task ExpiryAfterOversleepAndDisposeCancelRetry()
    {
        long now = 0; var calls = 0;
        var sender = new Sender((_, _, _) => { calls++; return Task.FromResult(new FrontendTelemetryResponse(503)); });
        await using (var reporter = new FrontendTelemetryReporter(Options(sender), () => now, (_, _) => { now += 301000; return Task.CompletedTask; }))
        { for (var i = 0; i < 17; i++) reporter.RecordCheck("flag", $"v{i}"); await reporter.FlushTelemetryAsync(); Assert.Equal(1, calls); }
        var sleeping = new TaskCompletionSource(); var bodies = new List<byte[]>(); var exits = new List<bool>();
        sender = new Sender((b, exit, _) => { bodies.Add(b); exits.Add(exit); return Task.FromResult(new FrontendTelemetryResponse(bodies.Count == 1 ? 503 : 202)); });
        await using var second = new FrontendTelemetryReporter(Options(sender), delay: async (_, ct) => { sleeping.SetResult(); await Task.Delay(Timeout.Infinite, ct); });
        second.RecordUsage("old"); var flush = second.FlushTelemetryAsync(); await sleeping.Task;
        for (var i = 0; i < 17; i++) second.RecordCheck("new", $"v{i}");
        await second.DisposeAsync(); await flush;
        Assert.Equal(2, bodies.Count); Assert.True(exits.Last());
        second.RecordUsage("ignored"); await second.FlushTelemetryAsync(); Assert.Equal(2, bodies.Count);
    }

    [Fact]
    public async Task DisposeOnlyOneFinalEnvelopeAndBoundsStalledTransport()
    {
        var calls = 0;
        var sender = new Sender((_, exit, _) => { calls++; Assert.True(exit); return Task.FromResult(new FrontendTelemetryResponse(503)); });
        var reporter = new FrontendTelemetryReporter(Options(sender));
        for (var i = 0; i < 17; i++) reporter.RecordCheck("f", $"v{i}");
        await reporter.DisposeAsync(); Assert.Equal(1, calls);
        var cancelled = new TaskCompletionSource();
        sender = new Sender(async (_, _, ct) => { try { await Task.Delay(Timeout.Infinite, ct); } finally { cancelled.TrySetResult(); } return new(202); });
        reporter = new(Options(sender), timeout: TimeSpan.FromMilliseconds(30)); reporter.RecordUsage("f");
        await reporter.DisposeAsync(); await cancelled.Task.WaitAsync(TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task InvalidInputsCompressionDiagnosticsAndRejectedConfigAreIsolated()
    {
        var capture = new TelemetryCapture(); var diagnostics = new List<string>();
        await using var reporter = new FrontendTelemetryReporter(Options(capture) with { TelemetryFlushIntervalMs = 1, OnTelemetryDiagnostic = code => { diagnostics.Add(code); throw new Exception("consumer"); } }, compress: _ => throw new Exception("gzip"));
        reporter.RecordUsage("f", "bad\n"); reporter.RecordUsage("f", null!); reporter.RecordUsage(" ");
        foreach (var n in new[] { double.NaN, double.PositiveInfinity, -1, 1000001, 1.5 }) reporter.IncrementCounter("m", n);
        reporter.SetGauge(" ", 0); reporter.RecordView("valid"); await reporter.FlushTelemetryAsync();
        Assert.Single(capture.Bodies); Assert.All(diagnostics, code => Assert.True(code.Length < 30));
        foreach (var options in new[] { Options(capture) with { EnableTelemetry = false }, Options(capture) with { AppKey = "" }, Options(capture) with { MetricsBaseUrl = "/bad" } })
        { await using var disabled = new FrontendTelemetryReporter(options); disabled.RecordUsage("ignored"); disabled.SetGauge("ignored", 1); await disabled.FlushTelemetryAsync(); }
        Assert.Single(capture.Bodies);
        var attempts = 0;
        await using var ambiguous = new FrontendTelemetryReporter(Options(new Sender((_, _, _) => { attempts++; throw new IOException(); })));
        ambiguous.RecordUsage("f"); await ambiguous.FlushTelemetryAsync(); Assert.Equal(1, attempts);
    }
    [Fact]
    public async Task InflightReservationsHeaderBytesAndLargeCounterAreBounded()
    {
        var started = new TaskCompletionSource(); var release = new TaskCompletionSource(); var bodies = new List<byte[]>();
        var sender = new Sender(async (b, _, _) => { bodies.Add(b); started.TrySetResult(); await release.Task; return new(202); });
        await using (var reporter = new FrontendTelemetryReporter(Options(sender)))
        {
            for (var i = 0; i < 2000; i++) reporter.RecordUsage($"f{i}");
            var flush = reporter.FlushTelemetryAsync(); await started.Task;
            reporter.RecordUsage("rejected"); reporter.IncrementCounter("rejected");
            release.SetResult(); await flush;
            Assert.Equal(2000, bodies.Sum(b => Body(b).GetProperty("f").EnumerateObject().Count()));
            Assert.DoesNotContain(bodies, b => Body(b).TryGetProperty("m", out _));
        }
        var capture = new TelemetryCapture();
        await using (var reporter = new FrontendTelemetryReporter(Options(capture) with { Environment = new string('"', 5000) }))
        {
            for (var i = 0; i < 20; i++) reporter.IncrementCounter("orders", 1000000);
            await reporter.FlushTelemetryAsync();
            Assert.InRange(capture.Bodies.Sum(b => b.Length), 1, 262144);
            Assert.All(capture.Bodies, b => Assert.True(b.Length <= 49152));
        }
        capture.Bodies.Clear();
        await using (var reporter = new FrontendTelemetryReporter(Options(capture)))
        {
            for (var i = 0; i < 2001; i++) reporter.IncrementCounter("orders", 1000000);
            await reporter.FlushTelemetryAsync();
            Assert.Equal(2000000000d, capture.Bodies.Sum(b => Body(b).GetProperty("m").GetProperty("orders").GetDouble()));
        }
    }

    [Fact]
    public async Task OnlyExplicitRetryStatusesAndLongerHttpDateAreRetried()
    {
        foreach (var status in new[] { 200, 204, 301, 400, 401, 403, 404, 413, 500 })
        {
            var attempts = 0;
            await using var reporter = new FrontendTelemetryReporter(Options(new Sender((_, _, _) => { attempts++; return Task.FromResult(new FrontendTelemetryResponse(status)); })));
            reporter.RecordUsage("f"); await reporter.FlushTelemetryAsync(); Assert.Equal(1, attempts);
        }
        var calls = 0; long now = 0; var waits = new List<int>();
        var sender = new Sender((_, _, _) => Task.FromResult(++calls == 1 ? new FrontendTelemetryResponse(429, DateTimeOffset.UtcNow.AddMinutes(2).ToString("R")) : new FrontendTelemetryResponse(202)));
        await using var dated = new FrontendTelemetryReporter(Options(sender), () => now, (ms, _) => { waits.Add(ms); now += ms; return Task.CompletedTask; });
        dated.RecordUsage("f"); await dated.FlushTelemetryAsync(); Assert.InRange(Assert.Single(waits), 118000, 120000);
    }

    [Fact]
    public async Task NativeTransportIsPrivateAndCallerHttpClientRemainsOwnedByCaller()
    {
        using var portProbe = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        portProbe.Start(); var port = ((System.Net.IPEndPoint)portProbe.LocalEndpoint).Port; portProbe.Stop();
        using var listener = new System.Net.HttpListener(); listener.Prefixes.Add($"http://127.0.0.1:{port}/"); listener.Start();
        var received = Task.Run(async () =>
        {
            var request = await listener.GetContextAsync();
            Assert.Equal("/base/api/frontend/telemetry", request.Request.Url!.AbsolutePath);
            Assert.Null(request.Request.Headers["Authorization"]); Assert.Null(request.Request.Headers["Origin"]); Assert.Null(request.Request.Headers["Cookie"]);
            Assert.Equal("gzip", request.Request.Headers["Content-Encoding"]);
            using var gzip = new System.IO.Compression.GZipStream(request.Request.InputStream, System.IO.Compression.CompressionMode.Decompress);
            using var body = new MemoryStream(); await gzip.CopyToAsync(body);
            Assert.Equal("test-app", Body(body.ToArray()).GetProperty("k").GetString());
            request.Response.StatusCode = 202; request.Response.Close();
        });
        using var http = new HttpClient(new DefinitionsHandler()); http.DefaultRequestHeaders.Authorization = new("Bearer", "definitions-only");
        var client = new TogglyClient(new() { AppKey = "test-app", MetricsBaseUrl = $"http://127.0.0.1:{port}/base/", Context = new("private", ["secret-group"]) }, http, new Verifier());
        Assert.False(client.IsEnabled("off")); await client.FlushTelemetryAsync(); await received.WaitAsync(TimeSpan.FromSeconds(3)); await client.DisposeAsync();
        using var response = await http.GetAsync("https://definitions.test/"); Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);
    }
    [Fact]
    public async Task DelayedPreparationCannotSendOrRecreateResourcesAfterDisposal()
    {
        using var started = new ManualResetEventSlim(); using var release = new ManualResetEventSlim();
        var calls = 0;
        var reporter = new FrontendTelemetryReporter(Options(new CountingTransport(() => Interlocked.Increment(ref calls))),
            compress: bytes => { started.Set(); release.Wait(); return bytes; }, timeout: TimeSpan.FromMilliseconds(30));
        reporter.RecordUsage("old");
        var flush = Task.Run(() => reporter.FlushTelemetryAsync());
        Assert.True(started.Wait(TimeSpan.FromSeconds(2)));
        await reporter.DisposeAsync(); release.Set(); await flush;
        Assert.Equal(0, calls);
    }
    private sealed class CountingTransport(Action onSend) : IFrontendTelemetryTransport
    {
        public Task<FrontendTelemetryResponse> SendAsync(Uri uri, ReadOnlyMemory<byte> body, bool gzip, bool keepalive, CancellationToken ct) { onSend(); return Task.FromResult(new FrontendTelemetryResponse(202)); }
    }
    [Fact]
    public async Task ThrowingTransportCancellationCannotEscapeTeardown()
    {
        var reporter = new FrontendTelemetryReporter(Options(new Sender(async (_, _, ct) =>
        {
            using var registration = ct.Register(() => throw new InvalidOperationException("host cancellation"));
            await Task.Delay(Timeout.Infinite, ct);
            return new(202);
        })), timeout: TimeSpan.FromMilliseconds(20));
        var failure = await Record.ExceptionAsync(async () =>
        {
            reporter.RecordUsage("f");
            await reporter.FlushTelemetryAsync();
            await reporter.DisposeAsync();
        });
        Assert.Null(failure);
    }
    private sealed class DefinitionsHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK));
    }
    private sealed class Sender(Func<byte[], bool, CancellationToken, Task<FrontendTelemetryResponse>> send) : IFrontendTelemetryTransport
    {
        public Task<FrontendTelemetryResponse> SendAsync(Uri endpoint, ReadOnlyMemory<byte> payload, bool gzip, bool keepalive, CancellationToken ct)
        {
            var bytes = payload.ToArray();
            if (gzip) { using var input = new System.IO.Compression.GZipStream(new MemoryStream(bytes), System.IO.Compression.CompressionMode.Decompress); using var output = new MemoryStream(); input.CopyTo(output); bytes = output.ToArray(); }
            return send(bytes, keepalive, ct);
        }
    }
}
