using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Components.Rendering;
using System.Security.Claims;
using Toggly.FeatureManagement.Client;
namespace Toggly.FeatureManagement.Blazor;

/// <summary>Initializes at the correct render phase and tracks the host's authentication state.</summary>
public sealed class FeatureProvider : ComponentBase, IDisposable
{
    [Inject] public IFeatureSession Session { get; set; } = default!;
    [Inject] public IServiceProvider Services { get; set; } = default!;
    [Parameter] public RenderFragment? ChildContent { get; set; }
    [Parameter] public Func<ClaimsPrincipal, EvaluationContext> ContextSelector { get; set; } = UserContext;
    private AuthenticationStateProvider? authentication;
    private readonly CancellationTokenSource lifetime = new();
    private bool disposed;
    private long authGeneration;
    protected override async Task OnInitializedAsync()
    {
        authentication = Services.GetService(typeof(AuthenticationStateProvider)) as AuthenticationStateProvider;
        if (authentication is not null) authentication.AuthenticationStateChanged += AuthenticationChanged;
        if (!Session.RequiresBrowser) await InitializeAsync();
    }
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender && Session.RequiresBrowser) { await InitializeAsync(); if (!disposed) StateHasChanged(); }
    }
    private async Task InitializeAsync()
    {
        if (authentication is not null) await ApplyAuthenticationAsync(authentication.GetAuthenticationStateAsync());
        if (!disposed) await Session.InitializeAsync(lifetime.Token);
    }
    private void AuthenticationChanged(Task<AuthenticationState> state)
    {
        if (!disposed) _ = InvokeAsync(() => ApplyAuthenticationAsync(state));
    }
    private async Task ApplyAuthenticationAsync(Task<AuthenticationState> state)
    {
        var version = ++authGeneration;
        var result = await state;
        if (!disposed && version == authGeneration) await Session.SetContextAsync(ContextSelector(result.User), lifetime.Token);
    }
    public static EvaluationContext UserContext(ClaimsPrincipal user) => user.Identity?.IsAuthenticated == true
        ? new(user.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? user.Identity.Name,
            user.FindAll(ClaimTypes.Role).Select(c => c.Value).ToArray(),
            user.Claims.GroupBy(c => c.Type).ToDictionary(g => g.Key, g => g.First().Value)) : new();
    protected override void BuildRenderTree(RenderTreeBuilder builder) => builder.AddContent(0, ChildContent);
    public void Dispose()
    {
        disposed = true; authGeneration++;
        if (authentication is not null) authentication.AuthenticationStateChanged -= AuthenticationChanged;
        lifetime.Cancel(); lifetime.Dispose();
    }
}
