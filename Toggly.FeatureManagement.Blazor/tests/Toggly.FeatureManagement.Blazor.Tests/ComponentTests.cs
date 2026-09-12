using Bunit;
using Bunit.TestDoubles;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.Extensions.DependencyInjection;
using Toggly.FeatureManagement.Blazor;
using Toggly.FeatureManagement.Client;
using Xunit;

namespace Blazor.Tests;

public class ComponentTests : BlazorTestContext
{
    [Fact]
    public async Task GateRendersLoadingThenDispatchesLiveChangesAndUnsubscribes()
    {
        var session = new FakeSession { ApplyNegate = true };
        Services.AddSingleton<IFeatureSession>(session);
        var cut = Render(PairedFeatures(key: "on", loading: "loading"));
        Assert.Equal("loading", cut.Markup);
        session.Ready = true;
        session.Value = true;
        await Task.Run(session.Notify);
        cut.WaitForAssertion(() => Assert.Equal("enabled", cut.Markup));
        session.Value = false;
        session.Notify();
        cut.WaitForAssertion(() => Assert.Equal("disabled", cut.Markup));
        await DisposeComponentsAsync();
        Assert.Equal(0, session.Subscriptions);
        session.Notify();
    }

    [Fact]
    public void FeatureExposesChildContentWithoutEnabledOrDisabledFragments()
    {
        Assert.NotNull(typeof(Feature).GetProperty(nameof(Feature.ChildContent)));
        Assert.Null(typeof(Feature).GetProperty("Enabled"));
        Assert.Null(typeof(Feature).GetProperty("Disabled"));
    }

    [Fact]
    public void PairedGatesForwardIdenticalMultiKeysRequirementAndEntity()
    {
        var session = new FakeSession
        {
            Ready = true,
            Value = true,
            ApplyNegate = true,
        };
        Services.AddSingleton<IFeatureSession>(session);
        var entity = new EntityContext(
            "Order",
            "ord-vip",
            new Dictionary<string, object?> { { "Vip", true } }
        );
        var cut = Render(
            PairedFeatures(keys: ["a", "b"], requirement: Requirement.Any, entity: entity)
        );
        Assert.Equal("enabled", cut.Markup);
        Assert.Collection(
            session.Requests,
            request => AssertRequest(request, false, entity),
            request => AssertRequest(request, true, entity)
        );
    }

    [Fact]
    public void BrowserInitializationNotifiesAfterReadiness()
    {
        AddAuthorization();
        using var http = new HttpClient();
        var session = new BrowserFeatureSession(
            new(
                new()
                {
                    Defaults = new Dictionary<string, bool> { { "on", true } }
                },
                http,
                new Reject()
            )
        );
        Services.AddSingleton<IFeatureSession>(session);
        var cut = Render<FeatureProvider>(p =>
            p.AddChildContent<Feature>(f =>
                f.Add(x => x.Key, "on").AddChildContent("enabled").Add(x => x.Loading, "loading")
            )
        );
        cut.WaitForAssertion(() => Assert.Contains("enabled", cut.Markup));
    }

    [Fact]
    public void PublicSnapshotProjectsAllowlistedBooleanValuesOnly()
    {
        var snapshot = new FeatureSnapshot(
            new Dictionary<string, bool> { { "public", true }, { "secret", true } },
            ["public"]
        );
        Assert.True(snapshot.TryEvaluate(["public"], Requirement.All, false, out var value));
        Assert.True(value);
        Assert.False(snapshot.TryEvaluate(["secret"], Requirement.All, false, out _));
        Assert.DoesNotContain("secret", System.Text.Json.JsonSerializer.Serialize(snapshot.Values));
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task ReadySessionShowsLoadingOrEmptyUntilEvaluationCompletes(
        bool result,
        bool loadingContent
    )
    {
        var positive = new TaskCompletionSource<bool>();
        var negative = new TaskCompletionSource<bool>();
        var session = new FakeSession { Ready = true };
        session.EvaluateRequest = (_, _, negate, _) => negate ? negative.Task : positive.Task;
        Services.AddSingleton<IFeatureSession>(session);
        var cut = Render(PairedFeatures(key: "on", loading: loadingContent ? "loading" : null));
        Assert.Equal(loadingContent ? "loading" : "", cut.Markup);
        await cut.InvokeAsync(() =>
        {
            positive.SetResult(result);
            negative.SetResult(!result);
        });
        cut.WaitForAssertion(() => Assert.Equal(result ? "enabled" : "disabled", cut.Markup));
    }

    [Fact]
    public async Task SupersededParametersCannotCompleteTheCurrentPendingEvaluation()
    {
        var old = new TaskCompletionSource<bool>();
        var current = new TaskCompletionSource<bool>();
        var session = new FakeSession { Ready = true, Evaluate = () => old.Task };
        Services.AddSingleton<IFeatureSession>(session);
        var cut = Render<Feature>(p =>
            p.Add(x => x.Key, "old").AddChildContent("enabled").Add(x => x.Loading, "loading")
        );
        session.Evaluate = () => current.Task;
        cut.Render(p => p.Add(x => x.Key, "current"));
        Assert.Equal(new[] { "current" }, session.Keys);
        await cut.InvokeAsync(() => old.SetResult(true));
        Assert.Equal("loading", cut.Markup);
        await cut.InvokeAsync(() => current.SetResult(false));
        cut.WaitForAssertion(() => Assert.Equal("", cut.Markup));
    }

    [Fact]
    public async Task LiveContextChangesShowLoadingAndIgnoreOlderCompletionAndDisposal()
    {
        var session = new FakeSession { Ready = true, Value = true };
        Services.AddSingleton<IFeatureSession>(session);
        var cut = Render<Feature>(p =>
            p.Add(x => x.Key, "on").AddChildContent("enabled").Add(x => x.Loading, "loading")
        );
        Assert.Equal("enabled", cut.Markup);
        var old = new TaskCompletionSource<bool>();
        session.Evaluate = () => old.Task;
        await cut.InvokeAsync(() =>
            session.SetContextAsync(new EvaluationContext { Identity = "alice" })
        );
        Assert.Equal("loading", cut.Markup);
        var current = new TaskCompletionSource<bool>();
        session.Evaluate = () => current.Task;
        await cut.InvokeAsync(() =>
            session.SetContextAsync(new EvaluationContext { Identity = "bob" })
        );
        await cut.InvokeAsync(() => current.SetResult(false));
        cut.WaitForAssertion(() => Assert.Equal("", cut.Markup));
        await cut.InvokeAsync(() => old.SetResult(true));
        Assert.Equal("", cut.Markup);
        var disposed = new TaskCompletionSource<bool>();
        session.Evaluate = () => disposed.Task;
        await cut.InvokeAsync(session.Notify);
        Assert.Equal("loading", cut.Markup);
        await DisposeComponentsAsync();
        var renders = cut.RenderCount;
        await Renderer.Dispatcher.InvokeAsync(() => disposed.SetResult(true));
        Assert.Equal(renders, cut.RenderCount);
        Assert.Equal(0, session.Subscriptions);
    }

    [Fact]
    public async Task HydrationRemainsImmediateUntilReadySessionStartsItsOwnEvaluation()
    {
        var state = AddBunitPersistentComponentState();
        var positive = new TaskCompletionSource<bool>();
        var negative = new TaskCompletionSource<bool>();
        var calls = 0;
        var session = new FakeSession();
        session.EvaluateRequest = (_, _, negate, _) =>
        {
            calls++;
            return negate ? negative.Task : positive.Task;
        };
        Services.AddSingleton<IFeatureSession>(session);
        state.Persist("toggly-public-flags", new Dictionary<string, bool> { ["public"] = true });
        var cut = Render<FeatureHydration>(p =>
            p.Add(x => x.PublicKeys, new[] { "public" })
                .AddChildContent(PairedFeatures(key: "public", loading: "loading"))
        );
        Assert.Equal("enabled", cut.Markup);
        Assert.Equal(0, calls);
        session.Ready = true;
        await cut.InvokeAsync(session.Notify);
        Assert.Equal("loading", cut.Markup);
        await cut.InvokeAsync(() =>
        {
            positive.SetResult(false);
            negative.SetResult(true);
        });
        cut.WaitForAssertion(() => Assert.Equal("disabled", cut.Markup));
    }

    private static void AssertRequest(
        (string[] Keys, Requirement Requirement, bool Negate, EntityContext? Entity) request,
        bool negate,
        EntityContext entity
    )
    {
        Assert.Equal(new[] { "a", "b" }, request.Keys);
        Assert.Equal(Requirement.Any, request.Requirement);
        Assert.Equal(negate, request.Negate);
        Assert.Same(entity, request.Entity);
    }

    private static RenderFragment PairedFeatures(
        string? key = null,
        string enabled = "enabled",
        string disabled = "disabled",
        string? loading = null,
        IEnumerable<string>? keys = null,
        Requirement requirement = Requirement.All,
        EntityContext? entity = null
    ) =>
        builder =>
        {
            builder.OpenComponent<Feature>(0);
            if (keys is null)
                builder.AddAttribute(1, nameof(Feature.Key), key);
            else
                builder.AddAttribute(1, nameof(Feature.Keys), keys);
            builder.AddAttribute(2, nameof(Feature.Requirement), requirement);
            builder.AddAttribute(3, nameof(Feature.Negate), false);
            builder.AddAttribute(4, nameof(Feature.Entity), entity);
            builder.AddAttribute(
                5,
                nameof(Feature.ChildContent),
                (RenderFragment)(child => child.AddContent(0, enabled))
            );
            if (loading is not null)
                builder.AddAttribute(
                    6,
                    nameof(Feature.Loading),
                    (RenderFragment)(child => child.AddContent(0, loading))
                );
            builder.CloseComponent();

            builder.OpenComponent<Feature>(10);
            if (keys is null)
                builder.AddAttribute(11, nameof(Feature.Key), key);
            else
                builder.AddAttribute(11, nameof(Feature.Keys), keys);
            builder.AddAttribute(12, nameof(Feature.Requirement), requirement);
            builder.AddAttribute(13, nameof(Feature.Negate), true);
            builder.AddAttribute(14, nameof(Feature.Entity), entity);
            builder.AddAttribute(
                15,
                nameof(Feature.ChildContent),
                (RenderFragment)(child => child.AddContent(0, disabled))
            );
            builder.CloseComponent();
        };

    private sealed class Reject : ISignatureVerifier
    {
        public ValueTask<bool> VerifyAsync(
            string a,
            long b,
            string c,
            string d,
            string e,
            CancellationToken ct = default
        ) => ValueTask.FromResult(false);
    }
}

public sealed class FakeSession : IFeatureSession
{
    public bool Ready,
        Value;
    public bool ApplyNegate;
    public bool Browser;
    public int Initializations,
        Refreshes,
        Subscriptions;
    public List<EvaluationContext> Contexts = [];
    public Func<Task<bool>>? Evaluate;
    public Func<string[], Requirement, bool, EntityContext?, Task<bool>>? EvaluateRequest;
    public List<(
        string[] Keys,
        Requirement Requirement,
        bool Negate,
        EntityContext? Entity
    )> Requests = [];
    public string[] Keys = [];
    public Requirement Requirement;
    public bool Negate;
    public EntityContext? Entity;
    private EventHandler? changed;
    public bool IsReady => Ready;
    public bool RequiresBrowser => Browser;
    public event EventHandler? Changed
    {
        add
        {
            changed += value;
            Subscriptions++;
        }
        remove
        {
            changed -= value;
            Subscriptions--;
        }
    }
    public event EventHandler<Exception>? Error
    {
        add
        {
        }
        remove
        {
        }
    }

    public void Notify() => changed?.Invoke(this, EventArgs.Empty);

    public Task InitializeAsync(CancellationToken ct = default)
    {
        Initializations++;
        Ready = true;
        Notify();
        return Task.CompletedTask;
    }

    public Task RefreshAsync(CancellationToken ct = default)
    {
        Refreshes++;
        Notify();
        return Task.CompletedTask;
    }

    public Task SetContextAsync(EvaluationContext c, CancellationToken ct = default)
    {
        Contexts.Add(c);
        Notify();
        return Task.CompletedTask;
    }

    public Task<bool> EvaluateAsync(
        IEnumerable<string> keys,
        Requirement requirement = Requirement.All,
        bool negate = false,
        EntityContext? entity = null
    )
    {
        Keys = keys.ToArray();
        Requirement = requirement;
        Negate = negate;
        Entity = entity;
        Requests.Add((Keys, requirement, negate, entity));
        return EvaluateRequest?.Invoke(Keys, requirement, negate, entity)
            ?? Evaluate?.Invoke()
            ?? Task.FromResult(ApplyNegate && negate ? !Value : Value);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
