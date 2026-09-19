using System.Text.Json;
using Bunit;
using Microsoft.JSInterop;
using Microsoft.Extensions.DependencyInjection;
using Toggly.FeatureManagement.Blazor;
using Toggly.FeatureManagement.Client;
using Xunit;
namespace Blazor.Tests;

public class TelemetryTests : BlazorTestContext
{
    [Fact]
    public async Task BrowserTransportAndLifecycleDelegateToOnlyPortableOwner()
    {
        var js = JSInterop.SetupModule("./_content/Toggly.FeatureManagement.Blazor/toggly.js");
        var listener = js.SetupModule("attachTelemetry", _ => true);
        listener.SetupVoid("dispose").SetVoidResult();
        js.Setup<FrontendTelemetryResponse>("sendTelemetry", _ => true).SetResult(new(202));
        await using var module = new BrowserModule(JSInterop.JSRuntime);
        var transport = new BrowserTelemetryTransport(module);
        await transport.SendAsync(new Uri("https://collector.test/api/frontend/telemetry"), new byte[] { 1 }, true, false, default);
        var lifecycle = new BrowserTelemetryLifecycle(module);
        var client = new TogglyClient(new() { AppKey = "test-app", EnableLiveUpdates = false, TelemetryTransport = transport, Defaults = new Dictionary<string, bool> { ["on"] = true } }, new HttpClient(new EmptyHandler()), new Verifier());
        await using var session = new BrowserFeatureSession(client, lifecycle);
        await session.InitializeAsync(); await session.InitializeAsync();
        Assert.Single(js.Invocations["attachTelemetry"]);
        Assert.True(await session.EvaluateAsync(["on", "skip"], Requirement.Any));
        IFrontendTelemetry events = session;
        events.RecordUsage("on"); events.RecordView("on"); events.IncrementCounter("orders", 2); events.SetGauge("cart", 3);
        await events.FlushTelemetryAsync();
        await lifecycle.FlushTelemetry(true);
        Assert.Equal(2, js.Invocations["sendTelemetry"].Count);
        await session.DisposeAsync(); await lifecycle.DisposeAsync(); await lifecycle.FlushTelemetry(false);
        Assert.Single(listener.Invocations["dispose"]);
    }

    [Fact]
    public async Task LifecycleInteropFailureDoesNotPreventEvaluation()
    {
        var js = JSInterop.SetupModule("./_content/Toggly.FeatureManagement.Blazor/toggly.js");
        await using var module = new BrowserModule(JSInterop.JSRuntime);
        var lifecycle = new BrowserTelemetryLifecycle(module);
        var client = new TogglyClient(new() { Defaults = new Dictionary<string, bool> { ["on"] = true } }, new HttpClient(), new Verifier());
        await using var session = new BrowserFeatureSession(client, lifecycle);
        await session.InitializeAsync(); Assert.True(await session.EvaluateAsync(["on"]));
        await lifecycle.FlushTelemetry(false);
    }
    [Fact]
    public async Task KeyedRegistrationOnServerDoesNotCreateBrowserTelemetry()
    {
        Services.AddSingleton(new HttpClient());
        Services.AddTogglyBlazorWebAssembly(_ => new() { AppKey = "server-no-frontend", Defaults = new Dictionary<string, bool> { ["on"] = true } });
        var session = Services.GetRequiredService<IFeatureSession>();
        Assert.True(await session.EvaluateAsync(["on"]));
        var telemetry = Assert.IsAssignableFrom<IFrontendTelemetry>(session);
        telemetry.RecordUsage("on"); await telemetry.FlushTelemetryAsync(); await session.DisposeAsync();
        Assert.Empty(JSInterop.Invocations);
    }

    [Fact]
    public async Task BrowserCancellationAbortsItsFetch()
    {
        var imported = new FetchReference();
        await using var module = new BrowserModule(new Runtime(imported));
        var transport = new BrowserTelemetryTransport(module);
        using var cancel = new CancellationTokenSource();
        var sending = transport.SendAsync(new Uri("https://collector.test"), new byte[] { 1 }, false, true, cancel.Token);
        Assert.Equal(1, imported.Sends);
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => sending);
        Assert.Equal(1, imported.Aborts);
    }
    private sealed class FetchReference : IJSObjectReference
    {
        public int Sends, Aborts;
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args)
        {
            if (identifier == "abortTelemetry") { Aborts++; return ValueTask.FromResult(default(TValue)!); }
            Sends++; return new(new TaskCompletionSource<TValue>().Task);
        }
        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken ct, object?[]? args) => InvokeAsync<TValue>(identifier, args);
    }

    [Fact]
    public async Task LateBrowserAttachmentCannotReviveDisposedOwner()
    {
        var listener = new DelayedReference();
        var imported = new DelayedReference { Result = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        await using var module = new BrowserModule(new Runtime(imported));
        var lifecycle = new BrowserTelemetryLifecycle(module);
        var client = new TogglyClient(new(), new HttpClient(), new Verifier());
        var session = new BrowserFeatureSession(client, lifecycle);
        var initializing = session.InitializeAsync();
        await imported.Started.Task;
        await session.DisposeAsync();
        imported.Result.SetResult(listener);
        await Assert.ThrowsAsync<ObjectDisposedException>(() => initializing);
        Assert.Equal(1, listener.Disposals); Assert.Equal(1, listener.Calls);
        await lifecycle.FlushTelemetry(true);
        await session.DisposeAsync();
    }
    private sealed class Runtime(IJSObjectReference imported) : IJSRuntime
    {
        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => ValueTask.FromResult((TValue)imported);
        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken ct, object?[]? args) => InvokeAsync<TValue>(identifier, args);
    }
    private sealed class DelayedReference : IJSObjectReference
    {
        public TaskCompletionSource<IJSObjectReference>? Result;
        public TaskCompletionSource Started = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Calls, Disposals;
        public ValueTask DisposeAsync() { Disposals++; return ValueTask.CompletedTask; }
        public async ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args)
        { Calls++; Started.TrySetResult(); return Result is null ? default! : (TValue)await Result.Task; }
        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken ct, object?[]? args) => InvokeAsync<TValue>(identifier, args);
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task BrowserFacadeContainsCallerCancellationAndKeepsSharedFlight(bool alreadyCancelled)
    {
        var transport = new StalledTelemetry();
        using var http = new HttpClient();
        var client = new TogglyClient(new() { AppKey = "local", TelemetryTransport = transport }, http, new Verifier());
        await using var session = new BrowserFeatureSession(client);
        IFrontendTelemetry events = session;
        events.RecordUsage("on");
        using var cancellation = new CancellationTokenSource();
        if (alreadyCancelled) cancellation.Cancel();
        var pending = events.FlushTelemetryAsync(cancellation.Token);
        await transport.Started.Task.WaitAsync(TimeSpan.FromSeconds(1));
        var shared = events.FlushTelemetryAsync();
        cancellation.Cancel();
        var escaped = await Record.ExceptionAsync(() => pending).WaitAsync(TimeSpan.FromSeconds(1));
        transport.Completion.SetResult(new(202));
        await shared;
        Assert.Null(escaped); Assert.Equal(1, transport.Calls);
        Assert.False(transport.RequestToken.IsCancellationRequested);
        await events.FlushTelemetryAsync(); Assert.Equal(1, transport.Calls);
    }
    private sealed class StalledTelemetry : IFrontendTelemetryTransport
    {
        public int Calls;
        public CancellationToken RequestToken;
        public TaskCompletionSource Started = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<FrontendTelemetryResponse> Completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task<FrontendTelemetryResponse> SendAsync(Uri endpoint, ReadOnlyMemory<byte> payload, bool gzip, bool keepalive, CancellationToken ct)
        { Calls++; RequestToken = ct; Started.TrySetResult(); return Completion.Task.WaitAsync(ct); }
    }

    private sealed class EmptyHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable));
    }
    private sealed class Verifier : ISignatureVerifier
    {
        public ValueTask<bool> VerifyAsync(string a, long b, string c, string d, string e, CancellationToken ct = default) => ValueTask.FromResult(false);
    }
}
