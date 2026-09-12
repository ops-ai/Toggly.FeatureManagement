using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Toggly.FeatureManagement.Client;
namespace Toggly.FeatureManagement.Blazor;

/// <summary>Renders one of three fragments, and marshals live changes onto the renderer.</summary>
public sealed class Feature : ComponentBase, IDisposable
{
    [CascadingParameter] public FeatureSnapshot? Snapshot { get; set; }
    [Inject] public IFeatureSession Session { get; set; } = default!;
    [Parameter] public string? Key { get; set; }
    [Parameter] public IEnumerable<string>? Keys { get; set; }
    [Parameter] public Requirement Requirement { get; set; } = Requirement.All;
    [Parameter] public bool Negate { get; set; }
    [Parameter] public EntityContext? Entity { get; set; }
    [Parameter] public RenderFragment? ChildContent { get; set; }
    [Parameter] public RenderFragment? Enabled { get; set; }
    [Parameter] public RenderFragment? Disabled { get; set; }
    [Parameter] public RenderFragment? Loading { get; set; }
    private bool enabled, disposed, hydrated;
    private long generation;
    protected override void OnInitialized() => Session.Changed += Changed;
    protected override Task OnParametersSetAsync() => EvaluateAsync();
    private async Task EvaluateAsync()
    {
        var version = ++generation;
        var keys = (Keys ?? (Key is null ? [] : [Key])).ToArray();
        var result = false;
        hydrated = !Session.IsReady && Entity is null && Snapshot?.TryEvaluate(keys, Requirement, Negate, out result) == true;
        if (!hydrated) result = await Session.EvaluateAsync(keys, Requirement, Negate, Entity);
        if (!disposed && version == generation) enabled = result;
    }
    private void Changed(object? sender, EventArgs args)
    {
        if (!disposed) _ = InvokeAsync(async () => { if (disposed) return; await EvaluateAsync(); if (!disposed) StateHasChanged(); });
    }
    protected override void BuildRenderTree(RenderTreeBuilder builder)
        => builder.AddContent(0, !Session.IsReady && !hydrated ? Loading : enabled ? Enabled ?? ChildContent : Disabled);
    public void Dispose() { disposed = true; generation++; Session.Changed -= Changed; }
}
