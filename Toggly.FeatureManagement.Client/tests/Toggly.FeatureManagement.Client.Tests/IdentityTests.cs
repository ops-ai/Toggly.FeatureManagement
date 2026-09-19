using System.Net;
using System.Text.Json;
using Toggly.FeatureManagement.Client;
using Xunit;
namespace ClientTests;

public class IdentityTests
{
    [Fact]
    public async Task SharedContextTransitionScenariosExercisePublicClient()
    {
        var contract = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "telemetry-contract.json"))).RootElement;
        var scenarios = contract.GetProperty("contextTransitionScenarios").EnumerateArray().ToArray();
        Assert.NotEmpty(scenarios);
        foreach (var scenario in scenarios)
        {
            var capture = new TelemetryCapture(); using var http = new HttpClient(new Offline());
            var settings = scenario.GetProperty("options");
            var options = new TogglyClientOptions { AppKey = settings.GetProperty("appKey").GetString(), TelemetryTransport = capture, TrustedJwks = "{}",
                Environment = settings.TryGetProperty("environment", out var environment) ? environment.GetString()! : "Production",
                Context = new(settings.TryGetProperty("identity", out var initialIdentity) ? initialIdentity.GetString() : null),
                InstanceId = settings.TryGetProperty("instanceId", out var initialToken) ? initialToken.GetString() : null };
            await using var client = new TogglyClient(options, http, new Verifier());
            foreach (var item in scenario.GetProperty("events").EnumerateArray())
            {
                var args = item.EnumerateArray().ToArray();
                if (args[0].GetString() == "setContext")
                {
                    var context = args[1];
                    // App/environment replacement uses a new client in the portable API.
                    // Fail explicitly if this shared vector grows beyond identity transitions.
                    if (context.TryGetProperty("appKey", out var app)) Assert.Equal(options.AppKey, app.GetString());
                    if (context.TryGetProperty("environment", out var env)) Assert.Equal(options.Environment, env.GetString());
                    await client.SetIdentityAsync(new(context.TryGetProperty("identity", out var identity) ? identity.GetString() : null),
                        context.TryGetProperty("instanceId", out var token) ? token.GetString() : null);
                    continue;
                }
                var key = args[1].GetString()!;
                switch (args[0].GetString())
                {
                    case "recordUsage": client.RecordUsage(key, args.Length > 2 ? args[2].GetString()! : "enabled"); break;
                    case "recordView": client.RecordView(key, args.Length > 2 ? args[2].GetString()! : "enabled"); break;
                    case "incrementCounter": client.IncrementCounter(key, args[2].GetDouble()); break;
                    case "setGauge": client.SetGauge(key, args[2].GetDouble()); break;
                    default: throw new InvalidOperationException("Unknown shared transition event");
                }
            }
            await client.FlushTelemetryAsync();
            Assert.True(System.Text.Json.Nodes.JsonNode.DeepEquals(System.Text.Json.Nodes.JsonNode.Parse(scenario.GetProperty("envelopes").GetRawText()),
                new System.Text.Json.Nodes.JsonArray(capture.Bodies.Select(body => System.Text.Json.Nodes.JsonNode.Parse(body)).ToArray())), scenario.GetProperty("name").GetString());
        }
    }

    [Fact]
    public async Task ContextSwitchKeepsPreviouslyAcceptedEventsAndGaugesWithTheirUser()
    {
        var capture = new TelemetryCapture();
        using var http = new HttpClient(new Offline());
        await using var client = new TogglyClient(new()
        {
            AppKey = "local",
            Context = new("alice"),
            TelemetryTransport = capture,
            TrustedJwks = "{}"
        }, http, new Verifier());
        client.RecordUsage("before");
        client.SetGauge("cart", 7);
        await client.SetContextAsync(new("bob"));
        client.RecordUsage("after");
        client.SetGauge("cart", 2);
        await client.FlushTelemetryAsync();
        var packets = capture.Bodies.Select(b => JsonDocument.Parse(b).RootElement).ToArray();
        Assert.Equal(2, packets.Length);
        Assert.Equal("alice", packets[0].GetProperty("u").GetString());
        Assert.Equal(7, packets[0].GetProperty("m").GetProperty("cart").GetInt32());
        Assert.False(packets[0].GetProperty("f").TryGetProperty("after", out _));
        Assert.Equal("bob", packets[1].GetProperty("u").GetString());
        Assert.Equal(2, packets[1].GetProperty("m").GetProperty("cart").GetInt32());
    }
    [Fact]
    public async Task MintedDefinitionsSuppressClientClaimsAndRotateCacheAndEtags()
    {
        var handler = new Definitions();
        var store = new Snapshots();
        var capture = new TelemetryCapture();
        using var http = new HttpClient(handler);
        var context = new EvaluationContext("alice", ["beta"], new Dictionary<string, string> { ["plan"] = "pro" });
        await using var client = new TogglyClient(new()
        {
            AppKey = "local",
            Context = context,
            InstanceId = " token-a ",
            TrustedJwks = "{}",
            TelemetryTransport = capture
        }, http, new Verifier(), store);
        await client.RefreshAsync();
        client.RecordUsage("a");
        await client.RefreshAsync();
        await client.SetIdentityAsync(context, "token-b");
        client.RecordUsage("b");
        await client.SetContextAsync(new("bob", ["users"], new Dictionary<string, string> { ["plan"] = "free" }));
        client.RecordUsage("bob");
        await client.SetIdentityAsync(new(), " ");
        client.RecordUsage("anonymous");
        await client.FlushTelemetryAsync();
        Assert.Equal("?i=token-a", handler.Requests[0].Query);
        Assert.Equal("r1", handler.Requests[1].Tag);
        Assert.Equal("?i=token-b", handler.Requests[2].Query);
        Assert.Null(handler.Requests[2].Tag);
        Assert.Equal("?u=bob&g=users&claim.plan=free", handler.Requests[3].Query);
        Assert.Null(handler.Requests[3].Tag);
        Assert.DoesNotContain("i=", handler.Requests[4].Query);
        Assert.Equal(4, store.Keys.Distinct().Count());
        var packets = capture.Bodies.Select(b => JsonDocument.Parse(b).RootElement).ToArray();
        Assert.Equal("token-a", packets[0].GetProperty("i").GetString());
        Assert.False(packets[0].TryGetProperty("u", out _));
        Assert.Equal("token-b", packets[1].GetProperty("i").GetString());
        Assert.Equal("bob", packets[2].GetProperty("u").GetString());
        Assert.False(packets[3].TryGetProperty("i", out _));
        Assert.False(packets[3].TryGetProperty("u", out _));
    }

    [Fact]
    public async Task EvaluationRacingContextChangeKeepsCapturedAttribution()
    {
        using var entered = new ManualResetEventSlim();
        using var resume = new ManualResetEventSlim();
        var capture = new TelemetryCapture();
        using var http = new HttpClient(new Offline());
        await using var client = new TogglyClient(new()
        {
            AppKey = "local",
            Context = new("alice"),
            TrustedJwks = "{}",
            TelemetryTransport = capture,
            Defaults = new Dictionary<string, bool> { ["flag"] = true },
            LocalGates = new Dictionary<string, Func<bool>> { ["flag"] = () => { entered.Set(); Assert.True(resume.Wait(TimeSpan.FromSeconds(5))); return true; } }
        }, http, new Verifier());
        var evaluating = Task.Run(() => client.IsEnabled("flag"));
        Assert.True(entered.Wait(TimeSpan.FromSeconds(5)));
        try
        {
            await client.SetIdentityAsync(new("bob"), "bob-token");
            client.RecordUsage("new");
        }
        finally { resume.Set(); }
        Assert.True(await evaluating);
        await client.FlushTelemetryAsync();
        var packets = capture.Bodies.Select(b => JsonDocument.Parse(b).RootElement).ToArray();
        Assert.Equal("bob-token", packets[0].GetProperty("i").GetString());
        Assert.Equal("alice", packets[1].GetProperty("u").GetString());
        Assert.Equal("[1]", packets[1].GetProperty("f").GetProperty("flag").GetProperty("enabled").GetRawText());
    }

    [Theory]
    [InlineData(429)]
    [InlineData(503)]
    public async Task InflightRetryRetainsOldIdentityAndGaugeBeforeNewIdentity(int status)
    {
        var sent = new List<JsonElement>();
        var waiting = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var resume = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        long now = 0;
        var sender = new Sender((body, _) => { sent.Add(JsonDocument.Parse(body).RootElement); return Task.FromResult(new FrontendTelemetryResponse(sent.Count == 1 ? status : 202)); });
        await using var reporter = new FrontendTelemetryReporter(new()
        {
            AppKey = "local",
            TelemetryTransport = sender
        }, () => now,
            async (ms, ct) => { waiting.SetResult(); await resume.Task.WaitAsync(ct); now += ms; });
        var alice = TelemetryIdentity.Create("a", "alice");
        var bob = TelemetryIdentity.Create("b", "bob");
        reporter.SetGauge("cart", 9, alice);
        var flush = reporter.FlushTelemetryAsync();
        await waiting.Task.WaitAsync(TimeSpan.FromSeconds(2));
        reporter.SetGauge("cart", 2, bob);
        reporter.RecordUsage("new", "enabled", bob);
        resume.SetResult();
        await flush;
        Assert.Equal(3, sent.Count);
        Assert.Equal(sent[0].GetRawText(), sent[1].GetRawText());
        Assert.Equal("a", sent[1].GetProperty("i").GetString());
        Assert.Equal(9, sent[1].GetProperty("m").GetProperty("cart").GetInt32());
        Assert.Equal("b", sent[2].GetProperty("i").GetString());
        Assert.Equal(2, sent[2].GetProperty("m").GetProperty("cart").GetInt32());
    }

    [Fact]
    public async Task RapidTransitionsShareOneAdmissionBudgetAndReleaseKindsAfterDrain()
    {
        var capture = new TelemetryCapture();
        var diagnostics = new List<string>();
        await using var reporter = new FrontendTelemetryReporter(new()
        {
            AppKey = "local",
            TelemetryTransport = capture,
            OnTelemetryDiagnostic = diagnostics.Add
        });
        for (var i = 0; i < 3000; i++)
            reporter.SetGauge("g" + i, 1, TelemetryIdentity.Create("token" + i, null));
        await reporter.FlushTelemetryAsync();
        Assert.Equal(2000, capture.Bodies.Count);
        Assert.Contains("buffer-limit", diagnostics);
        Assert.True(capture.Bodies.Sum(b => b.Length) <= 262144);
        reporter.IncrementCounter("g0", 1, TelemetryIdentity.Create("next", null));
        await reporter.FlushTelemetryAsync();
        Assert.Equal(2001, capture.Bodies.Count);
        capture.Bodies.Clear();
        var huge = TelemetryIdentity.Create(new string('x', 49000), null);
        for (var i = 0; i < 20; i++)
            reporter.RecordUsage("f", "enabled", huge with
            {
                InstanceId = huge.InstanceId + i
            });
        await reporter.FlushTelemetryAsync();
        Assert.True(capture.Bodies.Count is > 0 and < 20);
        Assert.True(capture.Bodies.Sum(b => b.Length) <= 262144);
        Assert.All(capture.Bodies, b => Assert.True(b.Length <= 49152));
    }

    [Fact]
    public async Task LateDefinitionsCannotInstallPreviousTokenState()
    {
        var handler = new DelayedDefinitions();
        using var http = new HttpClient(handler);
        await using var client = new TogglyClient(new()
        {
            AppKey = "local",
            InstanceId = "a",
            TrustedJwks = "{}",
            EnableTelemetry = false
        }, http, new Verifier());
        var old = client.RefreshAsync();
        await handler.Started.Task;
        var replacement = client.SetIdentityAsync(new("bob"), "b");
        handler.Resume.SetResult();
        await Task.WhenAll(old, replacement);
        Assert.False(client.IsEnabled("old"));
        Assert.True(client.IsEnabled("new"));
        Assert.Equal(new[] { "?i=a", "?i=b" }, handler.Queries);
    }

    [Fact]
    public async Task SnapshotRestartNeverFallsBackToAnotherTokenOrClientIdentity()
    {
        var store = new Snapshots();
        var context = new EvaluationContext("same-user");
        var options = new TogglyClientOptions { AppKey = "local", Context = context, TrustedJwks = "{}", EnableTelemetry = false };
        using var online = new HttpClient(new Definitions());
        using var offline = new HttpClient(new Offline());
        foreach (var token in new string?[] { null, "a" })
        {
            await using var seed = new TogglyClient(options with
            {
                InstanceId = token
            }, online, new Verifier(), store);
            await seed.RefreshAsync();
            Assert.True(seed.IsEnabled("flag"));
        }
        await using var same = new TogglyClient(options with
        {
            InstanceId = "a"
        }, offline, new Verifier(), store);
        await same.RefreshAsync();
        Assert.True(same.IsEnabled("flag"));
        await using var different = new TogglyClient(options with
        {
            InstanceId = "b"
        }, offline, new Verifier(), store);
        await different.RefreshAsync();
        Assert.False(different.IsEnabled("flag"));
        await different.SetIdentityAsync(context, "a");
        Assert.True(different.IsEnabled("flag"));
        await different.SetContextAsync(context);
        Assert.True(different.IsEnabled("flag"));
    }

    [Fact]
    public async Task IdentityQueueDisposalSendsAtMostOneEnvelopeAndNeverResurrects()
    {
        var capture = new TelemetryCapture();
        var reporter = new FrontendTelemetryReporter(new()
        {
            AppKey = "local",
            TelemetryTransport = capture
        });
        for (var i = 0; i < 20; i++)
            reporter.RecordUsage("before", "enabled", TelemetryIdentity.Create("t" + i, null));
        await reporter.DisposeAsync();
        reporter.RecordUsage("after", "enabled", TelemetryIdentity.Create("new", null));
        await reporter.FlushTelemetryAsync();
        await reporter.DisposeAsync();
        Assert.Single(capture.Bodies);
        Assert.Equal("t0", JsonDocument.Parse(capture.Bodies[0]).RootElement.GetProperty("i").GetString());
    }

    [Theory]
    [InlineData(false, "local")]
    [InlineData(true, null)]
    public async Task IdentityTransitionsRemainSilentWhenDisabledOrKeyless(bool enabled, string? key)
    {
        var capture = new TelemetryCapture();
        using var http = new HttpClient(new Offline());
        await using var client = new TogglyClient(new()
        {
            AppKey = key,
            EnableTelemetry = enabled,
            TelemetryTransport = capture,
            TrustedJwks = "{}"
        }, http, new Verifier());
        client.RecordUsage("before");
        await client.SetIdentityAsync(new("alice"), "token");
        client.IsEnabled("flag");
        client.RecordView("after");
        client.IncrementCounter("count");
        client.SetGauge("value", 1);
        await client.SetContextAsync(new());
        await client.FlushTelemetryAsync();
        Assert.Empty(capture.Bodies);
    }

    private static string Envelope(string feature = "flag") => JsonSerializer.Serialize(new { defs = new Dictionary<string, bool> { [feature] = true }, timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(), kid = "test", signature = "test" });
    private sealed class Definitions : HttpMessageHandler
    {
        internal List<(string Query, string? Tag)> Requests = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add((request.RequestUri!.Query, request.Headers.TryGetValues("If-None-Match", out var values) ? values.Single() : null));
            var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Envelope()) };
            response.Headers.Add("X-Definitions-Revision", "r" + Requests.Count);
            return Task.FromResult(response);
        }
    }
    private sealed class DelayedDefinitions : HttpMessageHandler
    {
        internal TaskCompletionSource Started = new(TaskCreationOptions.RunContinuationsAsynchronously), Resume = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal List<string> Queries = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Queries.Add(request.RequestUri!.Query);
            var first = Queries.Count == 1;
            if (first)
            {
                Started.SetResult();
                await Resume.Task;
            }
            return new(HttpStatusCode.OK)
            {
                Content = new StringContent(Envelope(first ? "old" : "new"))
            };
        }
    }
    private sealed class Snapshots : ISnapshotStore
    {
        internal List<string> Keys = [];
        private readonly Dictionary<string, ClientSnapshot> values = [];
        public ValueTask<ClientSnapshot?> LoadAsync(string key, CancellationToken ct)
        {
            Keys.Add(key);
            return ValueTask.FromResult(values.GetValueOrDefault(key));
        }
        public ValueTask SaveAsync(string key, ClientSnapshot snapshot, CancellationToken ct)
        {
            values[key] = snapshot;
            return ValueTask.CompletedTask;
        }
    }
    private sealed class Sender(Func<byte[], CancellationToken, Task<FrontendTelemetryResponse>> send) : IFrontendTelemetryTransport
    {
        public Task<FrontendTelemetryResponse> SendAsync(Uri endpoint, ReadOnlyMemory<byte> payload, bool gzip, bool keepalive, CancellationToken ct)
        {
            using var input = new System.IO.Compression.GZipStream(new MemoryStream(payload.ToArray()), System.IO.Compression.CompressionMode.Decompress);
            using var output = new MemoryStream();
            if (gzip)
                input.CopyTo(output);
            else
                output.Write(payload.Span);
            return send(output.ToArray(), ct);
        }
    }
    private sealed class Offline : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
    }
}
