using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
namespace Toggly.FeatureManagement.Blazor;
/// <summary>Transfers only explicitly client-exposable, non-entity boolean flags between renderers.</summary>
public sealed class FeatureHydration : ComponentBase, IDisposable
{
    [Inject] public PersistentComponentState State { get; set; } = default!;
    [Inject] public IFeatureSession Session { get; set; } = default!;
    [Parameter, EditorRequired] public IReadOnlyList<string> PublicKeys { get; set; } = [];
    [Parameter] public string StateKey { get; set; } = "toggly-public-flags";
    [Parameter] public IComponentRenderMode? RenderMode { get; set; }
    [Parameter] public RenderFragment? ChildContent { get; set; }
    private PersistingComponentStateSubscription subscription;
    private FeatureSnapshot? snapshot;
    protected override void OnInitialized()
    {
        if (State.TryTakeFromJson<Dictionary<string,bool>>(StateKey, out var values) && values is not null)
            snapshot = new FeatureSnapshot(values, PublicKeys);
        subscription = State.RegisterOnPersisting(PersistAsync, RenderMode);
        Session.Changed += Changed;
    }
    private void Changed(object? sender, EventArgs args)
    {
        // Any context/definition change invalidates the prerendered result, including logout.
        if (snapshot is not null) { snapshot = null; _ = InvokeAsync(StateHasChanged); }
    }
    private async Task PersistAsync()
    {
        var values = new Dictionary<string,bool>();
        foreach (var key in PublicKeys.Distinct()) values[key] = await Session.EvaluateAsync([key]);
        State.PersistAsJson(StateKey, values);
    }
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenComponent<CascadingValue<FeatureSnapshot>>(0);
        builder.AddAttribute(1, "Value", snapshot);
        builder.AddAttribute(2, "ChildContent", ChildContent);
        builder.CloseComponent();
    }
    public void Dispose() { subscription.Dispose(); Session.Changed -= Changed; }
}
