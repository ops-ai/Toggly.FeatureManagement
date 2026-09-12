using Bunit;
using Bunit.TestDoubles;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.Extensions.DependencyInjection;
using System.Security.Claims;
using Toggly.FeatureManagement.Blazor;
using Toggly.FeatureManagement.Client;
using Xunit;
namespace Blazor.Tests;
public class ProviderTests:BlazorTestContext
{
    [Fact] public async Task ServerProviderTracksAuthenticationChangesAndLogoutThenUnsubscribes()
    {
        var authentication=AddAuthorization();authentication.SetAuthorized("alice");authentication.SetRoles("vip");authentication.SetClaims(new Claim("role","admin"));
        var session=new FakeSession();Services.AddSingleton<IFeatureSession>(session);
        var cut=Render<FeatureProvider>(p=>p.AddChildContent("content"));
        Assert.Equal(1,session.Initializations);Assert.Equal("alice",session.Contexts.Last().Identity);Assert.Contains("vip",session.Contexts.Last().Groups!);
        authentication.SetNotAuthorized();cut.WaitForAssertion(()=>Assert.Null(session.Contexts.Last().Identity));
        var count=session.Contexts.Count;await DisposeComponentsAsync();authentication.SetAuthorized("bob");Assert.Equal(count,session.Contexts.Count);
    }
    [Fact] public void NoAuthenticationServiceWorksForOfflineStaticHosts()
    {
        Services.Remove(Services.First(x=>x.ServiceType==typeof(AuthenticationStateProvider)));
        var session=new FakeSession();Services.AddSingleton<IFeatureSession>(session);
        Render<FeatureProvider>();Assert.Equal(1,session.Initializations);Assert.Empty(session.Contexts);
    }
    [Fact] public void AuthenticationMappingPrefersStableIdentifierAndAnonymousClearsEverything()
    {
        var user=new ClaimsPrincipal(new ClaimsIdentity([new(ClaimTypes.NameIdentifier,"42"),new(ClaimTypes.Name,"display"),new("role","first"),new("role","second")],"test"));
        var context=FeatureProvider.UserContext(user);Assert.Equal("42",context.Identity);Assert.Equal("first",context.Claims!["role"]);
        Assert.Null(FeatureProvider.UserContext(new()).Identity);
    }
    [Fact] public async Task HydrationPersistsOnlyExplicitPublicFlagsAndClearsOnContextChange()
    {
        var state=AddBunitPersistentComponentState();
        var session=new FakeSession();Services.AddSingleton<IFeatureSession>(session);
        state.Persist("toggly-public-flags",new Dictionary<string,bool>{{"public",true},{"secret",true}});
        var cut=Render<FeatureHydration>(p=>p.Add(x=>x.PublicKeys,new[]{"public"}).AddChildContent<Feature>(f=>f.Add(x=>x.Key,"public").Add(x=>x.Enabled,"enabled").Add(x=>x.Loading,"loading")));
        Assert.Equal("enabled",cut.Markup);
        session.Notify();cut.WaitForAssertion(()=>Assert.Equal("loading",cut.Markup));
        session.Value=true;state.TriggerOnPersisting();
        Assert.True(state.TryTake<Dictionary<string,bool>>("toggly-public-flags",out var values));Assert.Single(values!);Assert.True(values!["public"]);
        await DisposeComponentsAsync();Assert.Equal(0,session.Subscriptions);
    }
    [Fact] public async Task OlderAuthenticationCompletionDoesNotOverwriteNewUserOrInitializeDisposedProvider()
    {
        var authentication=new DeferredAuthentication();Services.AddSingleton<AuthenticationStateProvider>(authentication);
        var session=new FakeSession();Services.AddSingleton<IFeatureSession>(session);
        var cut=Render<FeatureProvider>();
        var old=new TaskCompletionSource<AuthenticationState>(TaskCreationOptions.RunContinuationsAsynchronously);
        await cut.InvokeAsync(()=>authentication.Publish(old.Task));
        await cut.InvokeAsync(()=>authentication.Publish(Task.FromResult(Authenticated("bob"))));
        cut.WaitForAssertion(()=>Assert.Equal("bob",session.Contexts.Last().Identity));
        old.SetResult(Authenticated("alice"));await cut.InvokeAsync(async()=>await Task.Yield());
        Assert.Equal("bob",session.Contexts.Last().Identity);
        await DisposeComponentsAsync();
        authentication.Initial.SetResult(Authenticated("initial-user"));
        await Task.Delay(30);
        Render<Feature>();
        Assert.Equal(0,session.Initializations);
    }
    private static AuthenticationState Authenticated(string name)=>new(new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name,name)],"test")));
    private sealed class DeferredAuthentication:AuthenticationStateProvider
    {
        public TaskCompletionSource<AuthenticationState> Initial=new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override Task<AuthenticationState> GetAuthenticationStateAsync()=>Initial.Task;
        public void Publish(Task<AuthenticationState> state)=>NotifyAuthenticationStateChanged(state);
    }
    [Fact] public void EmptySnapshotStaysLoadingAndBooleanCompositionMatchesCore()
    {
        AddBunitPersistentComponentState();Services.AddSingleton<IFeatureSession>(new FakeSession());
        var cut=Render<FeatureHydration>(p=>p.Add(x=>x.StateKey,"other").AddChildContent<Feature>(f=>f.Add(x=>x.Key,"missing").Add(x=>x.Loading,"loading")));
        Assert.Equal("loading",cut.Markup);
        var snapshot=new FeatureSnapshot(new Dictionary<string,bool>{{"a",true},{"b",false}},["a","b"]);
        Assert.True(snapshot.TryEvaluate(["a","b"],Requirement.Any,false,out var result));Assert.True(result);
        snapshot.TryEvaluate(["a","b"],Requirement.All,true,out result);Assert.True(result);
        snapshot.TryEvaluate([],Requirement.Any,false,out result);Assert.True(result);
    }
}
