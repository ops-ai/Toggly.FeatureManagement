using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Toggly.FeatureManagement.Client;

namespace Toggly.FeatureManagement.Blazor;

/// <summary>Renders one of three fragments, and marshals live changes onto the renderer.</summary>
public sealed class Feature : ComponentBase, IDisposable
{
    /// <summary>An optional allowlisted presentation snapshot from prerendering.</summary>
    [CascadingParameter]
    public FeatureSnapshot? Snapshot
    {
        get; set;
    }

    [Inject]
    public IFeatureSession Session { get; set; } = default!;

    /// <summary>A single feature key; Keys takes precedence when supplied.</summary>
    [Parameter]
    public string? Key
    {
        get; set;
    }

    /// <summary>The keys to combine using Requirement and Negate.</summary>
    [Parameter]
    public IEnumerable<string>? Keys
    {
        get; set;
    }

    [Parameter]
    public Requirement Requirement { get; set; } = Requirement.All;

    [Parameter]
    public bool Negate
    {
        get; set;
    }

    /// <summary>Entity data for this evaluation only; it is never taken from hydration.</summary>
    [Parameter]
    public EntityContext? Entity
    {
        get; set;
    }

    [Parameter]
    public RenderFragment? ChildContent
    {
        get; set;
    }

    [Parameter]
    public RenderFragment? Enabled
    {
        get; set;
    }

    [Parameter]
    public RenderFragment? Disabled
    {
        get; set;
    }

    /// <summary>Content shown before initialization or while the current evaluation is pending.</summary>
    [Parameter]
    public RenderFragment? Loading
    {
        get; set;
    }

    // Only the latest evaluation may replace content or end the pending state.
    private bool enabled,
        disposed,
        hydrated,
        pending;
    private long generation;

    protected override void OnInitialized() => Session.Changed += Changed;

    protected override Task OnParametersSetAsync() => EvaluateAsync();

    private async Task EvaluateAsync()
    {
        var version = ++generation;
        var keys = (Keys ?? (Key is null ? [] : [Key])).ToArray();
        var result = false;
        hydrated =
            !Session.IsReady
            && Entity is null
            && Snapshot?.TryEvaluate(keys, Requirement, Negate, out result) == true;
        pending = !hydrated;
        if (!hydrated)
            result = await Session.EvaluateAsync(keys, Requirement, Negate, Entity);
        if (!disposed && version == generation)
        {
            enabled = result;
            pending = false;
        }
    }

    private void Changed(object? sender, EventArgs args)
    {
        if (!disposed)
            _ = InvokeAsync(async () =>
            {
                if (disposed)
                    return;
                var evaluation = EvaluateAsync();
                // Live notifications do not receive ComponentBase's automatic intermediate render.
                StateHasChanged();
                await evaluation;
                if (!disposed)
                    StateHasChanged();
            });
    }

    protected override void BuildRenderTree(RenderTreeBuilder builder) =>
        builder.AddContent(
            0,
            pending || (!Session.IsReady && !hydrated) ? Loading
                : enabled ? Enabled ?? ChildContent
                : Disabled
        );

    public void Dispose()
    {
        disposed = true;
        generation++;
        Session.Changed -= Changed;
    }
}
