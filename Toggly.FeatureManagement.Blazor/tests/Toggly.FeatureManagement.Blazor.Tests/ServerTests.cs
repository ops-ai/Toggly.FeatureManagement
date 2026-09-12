using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Blazor;
using Toggly.FeatureManagement.Blazor.Server;
using Toggly.FeatureManagement.Client;
using Toggly.FeatureManagement.Context;
using Xunit;

namespace Blazor.Tests;

public class ServerTests
{
    [Fact]
    public async Task ConcurrentCircuitsKeepIdentityGroupsClaimsAndEntityIsolatedAcrossAwait()
    {
        var manager = new CheckingManager();
        await using var alice = new ServerFeatureSession(manager);
        await using var bob = new ServerFeatureSession(manager);
        var groups = new List<string> { "vip" };
        var claims = new Dictionary<string, string> { { "role", "admin" } };
        await alice.SetContextAsync(new("alice", groups, claims));
        groups.Clear();
        claims.Clear();
        await bob.SetContextAsync(
            new("bob", ["standard"], new Dictionary<string, string> { { "role", "user" } })
        );
        var entity = new EntityContext(
            "Order",
            "ord-vip",
            new Dictionary<string, object?> { { "Vip", true } }
        );
        var first = alice.EvaluateAsync(["alice"], entity: entity);
        var second = bob.EvaluateAsync(["bob"]);
        await alice.SetContextAsync(new("new-user"));
        manager.Release.SetResult();
        Assert.True(await first);
        Assert.True(await second);
        Assert.Equal("ord-vip", manager.Entity!.Entity!.Key);
        Assert.Contains(
            manager.Contexts,
            x =>
                x.Identity == "alice" && x.Groups!.Single() == "vip" && x.Claims!["role"] == "admin"
        );
        Assert.Contains(manager.Contexts, x => x.Identity == "bob" && x.Claims!["role"] == "user");
        Assert.Null(BlazorTargetingContext.Current.Identity);
        Assert.True(await alice.EvaluateAsync(["new-user"]));
    }

    [Fact]
    public async Task LifecycleRefreshReconnectAndDefinitionSubscriptionAreScopedAndDisposed()
    {
        var states = new StateService();
        var manager = new CheckingManager();
        manager.Release.SetResult();
        var session = new ServerFeatureSession(manager, states);
        Assert.False(session.IsReady);
        await session.InitializeAsync();
        states.Notify();
        await session.SetContextAsync(new());
        var changes = 0;
        session.Changed += (_, _) => changes++;
        Assert.False(session.RequiresBrowser);
        await session.InitializeAsync();
        Assert.True(session.IsReady);
        states.Notify();
        await new FeatureCircuitHandler(session).OnConnectionUpAsync(null!, default);
        Assert.Equal(3, changes);
        await session.DisposeAsync();
        await session.DisposeAsync();
        Assert.Equal(0, states.Count);
        states.Notify();
        Assert.Equal(3, changes);
        await Assert.ThrowsAsync<ObjectDisposedException>(() => session.EvaluateAsync(["a"]));
        await Assert.ThrowsAsync<ObjectDisposedException>(() => session.SetContextAsync(new()));
        await Assert.ThrowsAsync<ObjectDisposedException>(() => session.InitializeAsync());
    }

    [Fact]
    public async Task AllAnyNegateEmptyErrorsAndCancellationHaveExplicitBehavior()
    {
        var manager = new CheckingManager();
        manager.Release.SetResult();
        await using var session = new ServerFeatureSession(manager);
        await session.SetContextAsync(new("yes"));
        Assert.True(await session.EvaluateAsync([]));
        Assert.False(await session.EvaluateAsync([], negate: true));
        Assert.False(await session.EvaluateAsync(["yes", "no"]));
        Assert.True(await session.EvaluateAsync(["yes", "no"], Requirement.Any));
        Assert.True(await session.EvaluateAsync(["no"], negate: true));
        Exception? reported = null;
        session.Error += (_, ex) => reported = ex;
        await Assert.ThrowsAsync<InvalidOperationException>(() => session.EvaluateAsync(["throw"]));
        Assert.IsType<InvalidOperationException>(reported);
        Assert.Null(BlazorTargetingContext.Current.Identity);
        await Assert.ThrowsAsync<ArgumentNullException>(() => session.SetContextAsync(null!));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            session.InitializeAsync(new(true))
        );
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            session.SetContextAsync(new(), new(true))
        );
    }

    [Fact]
    public async Task RegistrationUsesScopedSessionsAndSingletonAsyncLocalAccessor()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddTogglyBlazorServer();
        var manager = new CheckingManager();
        manager.Release.SetResult();
        services.AddSingleton<IFeatureManager>(manager);
        await using var provider = services.BuildServiceProvider();
        await using var one = provider.CreateAsyncScope();
        await using var two = provider.CreateAsyncScope();
        var a = one.ServiceProvider.GetRequiredService<IFeatureSession>();
        var b = two.ServiceProvider.GetRequiredService<IFeatureSession>();
        Assert.NotSame(a, b);
        Assert.Same(a, one.ServiceProvider.GetRequiredService<IFeatureSession>());
        Assert.Same(
            one.ServiceProvider.GetRequiredService<ITargetingContextAccessor>(),
            two.ServiceProvider.GetRequiredService<ITargetingContextAccessor>()
        );
        await a.SetContextAsync(new("alice"));
        await b.SetContextAsync(new("bob"));
        Assert.True(await a.EvaluateAsync(["alice"]));
        Assert.False(await b.EvaluateAsync(["alice"]));
    }

    private sealed class CheckingManager : IFeatureManager
    {
        public TaskCompletionSource Release = new(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        public System.Collections.Concurrent.ConcurrentBag<EvaluationContext> Contexts = [];
        public TogglyEvaluationContext? Entity;

        public async Task<bool> IsEnabledAsync(string feature)
        {
            var before = await new BlazorTargetingContext().GetContextAsync();
            await Release.Task;
            var after = await new BlazorTargetingContext().GetContextAsync();
            Assert.Equal(before.UserId, after.UserId);
            var captured = BlazorTargetingContext.Current;
            if (captured.Claims is IDictionary<string, string> claims)
                Assert.Throws<NotSupportedException>(() => claims["role"] = "mutated");
            if (captured.Groups is IList<string> groups && groups.Count > 0)
                Assert.Throws<NotSupportedException>(() => groups[0] = "mutated");
            Contexts.Add(captured);
            if (feature == "throw")
                throw new InvalidOperationException("filter failed");
            return feature == after.UserId;
        }

        public Task<bool> IsEnabledAsync<T>(string feature, T context)
        {
            Entity = (TogglyEvaluationContext)(object)context!;
            return IsEnabledAsync(feature);
        }

        public async IAsyncEnumerable<string> GetFeatureNamesAsync()
        {
            await Task.CompletedTask;
            yield return "yes";
        }
    }

    private sealed class StateService : IFeatureStateService
    {
        private readonly Dictionary<Guid, Action> callbacks = [];
        public int Count => callbacks.Count;

        public Guid WhenDefinitionsChange(Action action)
        {
            var id = Guid.NewGuid();
            callbacks[id] = action;
            return id;
        }

        public bool UnregisterDefinitionsChange(Guid id) => callbacks.Remove(id);

        public void Notify()
        {
            foreach (var callback in callbacks.Values)
                callback();
        }

        public Guid WhenFeatureTurnsOn(string key, Action action) =>
            throw new NotSupportedException();

        public Guid WhenFeatureTurnsOn(object key, Action action) =>
            throw new NotSupportedException();

        public Guid WhenFeatureTurnsOff(string key, Action action) =>
            throw new NotSupportedException();

        public Guid WhenFeatureTurnsOff(object key, Action action) =>
            throw new NotSupportedException();

        public bool UnregisterFeatureStateChange(string key, Guid id) =>
            throw new NotSupportedException();
    }
}
