using Bunit;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.JSInterop;
using Toggly.FeatureManagement.Blazor;
using Toggly.FeatureManagement.Client;
using Xunit;
namespace Blazor.Tests;
public class BrowserAdapterTests:BlazorTestContext
{
    [Fact] public async Task ModuleIsLazySharedAcrossVerifierAndStorageAndDisposed()
    {
        var js=JSInterop.SetupModule("./_content/Toggly.FeatureManagement.Blazor/toggly.js");
        js.Setup<bool>("verify",_=>true).SetResult(true);
        js.Setup<ClientSnapshot?>("load",_=>true).SetResult(new("context","signed","revision"));
        js.SetupVoid("save",_=>true).SetVoidResult();
        await using var module=new BrowserModule(JSInterop.JSRuntime);
        var verifier=new BrowserSignatureVerifier(module);var storage=new BrowserSnapshotStore(module);
        Assert.True(await verifier.VerifyAsync("raw",1,"sig","kid","jwks"));
        Assert.Equal("signed",(await storage.LoadAsync("context"))!.Envelope);
        await storage.SaveAsync("context",new("context","signed","revision"));
        Assert.Single(JSInterop.Invocations["import"]);
    }
    [Fact] public async Task UnusedModuleDoesNotImportOnDisposal()
    {await using var module=new BrowserModule(JSInterop.JSRuntime);Assert.Empty(JSInterop.Invocations);}
    [Fact] public async Task BrowserRegistrationResolvesScopedPortableSessionsWithoutTrustedDependencies()
    {
        Services.AddSingleton(new HttpClient());Services.AddTogglyBlazorWebAssembly(_=>new(){Defaults=new Dictionary<string,bool>{{"on",true}}});
        var session=Services.GetRequiredService<IFeatureSession>();Assert.True(session.RequiresBrowser);
        await session.InitializeAsync();Assert.True(await session.EvaluateAsync(["on"]));await session.RefreshAsync();
        EventHandler<Exception> callback=(_,_)=>{};session.Error+=callback;session.Error-=callback;
        Assert.Throws<ArgumentNullException>(()=>new ServiceCollection().AddTogglyBlazorWebAssembly(null!));
    }
}
