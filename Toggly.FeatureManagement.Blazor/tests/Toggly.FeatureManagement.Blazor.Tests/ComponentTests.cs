using Bunit;
using Bunit.TestDoubles;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Toggly.FeatureManagement.Blazor;
using Toggly.FeatureManagement.Client;
using Xunit;
namespace Blazor.Tests;
public class ComponentTests : BlazorTestContext
{
    [Fact] public async Task GateRendersLoadingThenDispatchesLiveChangesAndUnsubscribes()
    {
        var session=new FakeSession(); Services.AddSingleton<IFeatureSession>(session);
        var cut=Render<Feature>(p=>p.Add(x=>x.Key,"on").Add(x=>x.Enabled,"enabled").Add(x=>x.Disabled,"disabled").Add(x=>x.Loading,"loading"));
        Assert.Equal("loading",cut.Markup);
        session.Ready=true; session.Value=true; await Task.Run(session.Notify);
        cut.WaitForAssertion(()=>Assert.Equal("enabled",cut.Markup));
        session.Value=false; session.Notify(); cut.WaitForAssertion(()=>Assert.Equal("disabled",cut.Markup));
        await DisposeComponentsAsync(); Assert.Equal(0,session.Subscriptions); session.Notify();
    }
    [Fact] public void NegationMultiKeysAndEntityAreForwardedAndChildContentIsEnabledFallback()
    {
        var session=new FakeSession{Ready=true,Value=true}; Services.AddSingleton<IFeatureSession>(session);
        var entity=new EntityContext("Order","ord-vip",new Dictionary<string,object?>{{"Vip",true}});
        var cut=Render<Feature>(p=>p.Add(x=>x.Keys,new[]{"a","b"}).Add(x=>x.Requirement,Requirement.Any).Add(x=>x.Negate,true).Add(x=>x.Entity,entity).AddChildContent("child"));
        Assert.Equal("child",cut.Markup); Assert.Equal(new[]{"a","b"},session.Keys); Assert.True(session.Negate); Assert.Equal(Requirement.Any,session.Requirement); Assert.Same(entity,session.Entity);
        cut.Render(p=>p.Add(x=>x.Keys,null)); Assert.Empty(session.Keys);
    }
    [Fact] public void BrowserInitializationNotifiesAfterReadiness()
    {
        AddAuthorization();
        using var http=new HttpClient();
        var session=new BrowserFeatureSession(new(new(){Defaults=new Dictionary<string,bool>{{"on",true}}},http,new Reject()));
        Services.AddSingleton<IFeatureSession>(session);
        var cut=Render<FeatureProvider>(p=>p.AddChildContent<Feature>(f=>f.Add(x=>x.Key,"on").Add(x=>x.Enabled,"enabled").Add(x=>x.Loading,"loading")));
        cut.WaitForAssertion(()=>Assert.Contains("enabled",cut.Markup));
    }
    [Fact] public void PublicSnapshotProjectsAllowlistedBooleanValuesOnly()
    {
        var snapshot=new FeatureSnapshot(new Dictionary<string,bool>{{"public",true},{"secret",true}},["public"]);
        Assert.True(snapshot.TryEvaluate(["public"],Requirement.All,false,out var value)); Assert.True(value);
        Assert.False(snapshot.TryEvaluate(["secret"],Requirement.All,false,out _));
        Assert.DoesNotContain("secret",System.Text.Json.JsonSerializer.Serialize(snapshot.Values));
    }
    private sealed class Reject:ISignatureVerifier { public ValueTask<bool> VerifyAsync(string a,long b,string c,string d,string e,CancellationToken ct=default)=>ValueTask.FromResult(false); }
}
public sealed class FakeSession:IFeatureSession
{
    public bool Ready, Value; public bool Browser; public int Initializations,Refreshes,Subscriptions; public List<EvaluationContext> Contexts=[];
    public string[] Keys=[]; public Requirement Requirement; public bool Negate; public EntityContext? Entity;
    private EventHandler? changed;
    public bool IsReady=>Ready; public bool RequiresBrowser=>Browser;
    public event EventHandler? Changed { add {changed+=value;Subscriptions++;} remove {changed-=value;Subscriptions--;} }
    public event EventHandler<Exception>? Error { add {} remove {} }
    public void Notify()=>changed?.Invoke(this,EventArgs.Empty);
    public Task InitializeAsync(CancellationToken ct=default){Initializations++;Ready=true;Notify();return Task.CompletedTask;}
    public Task RefreshAsync(CancellationToken ct=default){Refreshes++;Notify();return Task.CompletedTask;}
    public Task SetContextAsync(EvaluationContext c,CancellationToken ct=default){Contexts.Add(c);Notify();return Task.CompletedTask;}
    public Task<bool> EvaluateAsync(IEnumerable<string> keys,Requirement requirement=Requirement.All,bool negate=false,EntityContext? entity=null){Keys=keys.ToArray();Requirement=requirement;Negate=negate;Entity=entity;return Task.FromResult(Value);}
    public ValueTask DisposeAsync()=>ValueTask.CompletedTask;
}
