# Toggly.FeatureManagement.Blazor

Native Razor feature gates for static SSR, Interactive Server, WebAssembly and Interactive Auto on **.NET 8 or later**. Can be used with Toggly or with deliberate offline defaults.

## Install and choose a host

| Host | Package / registration | Evaluation scope |
| --- | --- | --- |
| Static SSR | `Toggly.FeatureManagement.Blazor.Server`, `AddTogglyBlazorServer()` | HTTP request |
| Interactive Server | Same server package | Circuit, refreshed on reconnect |
| WebAssembly | `Toggly.FeatureManagement.Blazor`, `AddTogglyBlazorWebAssembly(...)` | Browser DI scope |
| Interactive Auto | Server package in server project; browser package in client project | Each runtime creates its own session |

```sh
dotnet add package Toggly.FeatureManagement.Blazor --version 0.1.0
# Server project only:
dotnet add package Toggly.FeatureManagement.Blazor.Server --version 0.1.0
```

The server package reuses trusted `Toggly.FeatureManagement` 3.6.6. The browser package reuses portable `Toggly.FeatureManagement.Client` 0.1.0 and has no dependency on server evaluation or filesystem storage. The two packages target net8.0; use a compatible ASP.NET Core host and supported .NET runtime.

## Trusted server setup

```csharp
using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Blazor.Server;

builder.Services.AddToggly(options =>
{
    options.AppKey = builder.Configuration["TOGGLY_APP_KEY"] ?? "";
    options.Environment = "Production";
    options.UseSignedDefinitions = true;
    options.UndefinedEnabledOnDevelopment = false;
});
builder.Services.AddTogglyBlazorServer();
```

Keep the backend App Key in trusted server configuration. `AddTogglyBlazorServer` registers native Toggly filters and a singleton targeting accessor whose values exist only inside one asynchronous evaluation flow. It never puts mutable circuit identity in a singleton. Existing server definition polling, WebSocket updates, usage reporting, snapshots and signature policy remain owned by the trusted SDK. `RefreshAsync` on this adapter re-evaluates the current cached definitions; it does not force a server network fetch.

## Browser setup

In the WebAssembly client project's `Program.cs`:

```csharp
using Toggly.FeatureManagement.Blazor;
using Toggly.FeatureManagement.Client;

builder.Services.AddScoped(_ => new HttpClient());
builder.Services.AddTogglyBlazorWebAssembly(_ => new TogglyClientOptions
{
    AppKey = builder.Configuration["Toggly:FrontendAppKey"],
    Environment = "Production",
    Defaults = new Dictionary<string, bool> { ["new-dashboard"] = false }
});
```

Obtain an additional **Front-end App Key** from App Settings and enable **Available to Client SDK** for each exposed flag. Configure exact allowed browser origins. No Blazor-specific technology picker is required. Everything in client configuration is public: never use a backend or management credential here.

The browser fetches `evaluated-signed` definitions, forwards identity/groups/claims to the evaluation endpoint, verifies signed responses using WebCrypto, and evaluates returned entity gates locally. `BrowserSnapshotStore` uses sessionStorage, partitioned by the portable client's context key. Only signed envelopes are cached; cached data is verified before acceptance. Storage denial or quota limits leave network evaluation available. On a fully offline restart, cached envelopes can be verified only when `TrustedJwks` was configured out of band; otherwise the client uses defaults until it can obtain trusted keys. `MaximumSignatureAge`, `AllowedKeyIds`, `TrustedJwks`, `RefreshInterval`, `EnableLiveUpdates`, `LocalGates`, `BaseUri` and `WebSocketBaseUri` are portable client options; HTTPS/WSS endpoints are required.

A missing browser key makes initialization use defaults without remote calls. Unknown keys default OFF. Network/signature failure preserves valid last-known definitions or defaults and raises `Error`. Polling and WebSocket-triggered refresh are owned and canceled by the portable client.

## Components

Add the namespaces to `_Imports.razor`:

```razor
@using Toggly.FeatureManagement.Blazor
@using Toggly.FeatureManagement.Client
```

Wrap a render-mode subtree in `FeatureProvider`. The provider initializes trusted sessions during component initialization and browser sessions after the first interactive render, when JavaScript is available.

```razor
<FeatureProvider>
    <Feature Key="new-dashboard">
        <Enabled><p>New dashboard</p></Enabled>
        <Disabled><p>Classic dashboard</p></Disabled>
        <Loading><p>Loading feature definitions…</p></Loading>
    </Feature>
    <Feature Key="beta-access" Negate="true">
        <p>Join the beta waitlist.</p>
    </Feature>
    <Feature Keys="@(new[] { "new-dashboard", "api-v2" })"
             Requirement="Requirement.All">
        <p>Both features are enabled.</p>
    </Feature>
</FeatureProvider>
```

`ChildContent` is the enabled-content shorthand. Use `Requirement.Any` for at least one flag. An empty list evaluates true, then `Negate` applies. Do not combine `Key` and `Keys`: when `Keys` is supplied it takes precedence. Components subscribe to changes and marshal reevaluation through the renderer dispatcher; they unsubscribe on disposal.

Boolean content selection is not named variant/experiment assignment. The Blazor session API exposes boolean evaluation; use the trusted .NET variant API separately where appropriate. Presentation gates do not replace authorization of backend actions.

## Programmatic evaluation and identity

```razor
@inject IFeatureSession Features

@code {
    private Task<bool> UseApiV2() => Features.EvaluateAsync(["api-v2"]);
    private Task Refresh() => Features.RefreshAsync();
    private Task ChangeDemoUser() => Features.SetContextAsync(new EvaluationContext(
        Identity: "alice",
        Groups: ["vip"],
        Claims: new Dictionary<string, string> { ["role"] = "admin" }));
}
```

The session is scoped. Do not register it as a singleton or call `SetContextAsync` on a shared user client. A server evaluation snapshots context before awaiting, and restores the previous ambient context afterward. Browser context changes clear previous definitions before fetching the new user's result. Entity context belongs to each evaluation.

When `AuthenticationStateProvider` is registered, `FeatureProvider` maps the current authenticated user and follows authentication changes. The default selector uses NameIdentifier (falling back to Name), role claims as groups, and the first value for each claim type. Anonymous/logout maps to empty context. Supply `ContextSelector` for a different mapping. Browser claim values are untrusted targeting hints. The trusted adapter exposes `BlazorTargetingContext.Current` for custom filters, including scoped claims; it does not register HTTP-context-based segment or UserClaims filters for long-lived circuits.

Subscribe to `Features.Changed` and `Features.Error` for application status UI; dispatch UI work through `InvokeAsync` and unsubscribe in `Dispose`. The DI scope owns and disposes its session. Reconnecting an Interactive Server circuit reevaluates that circuit's existing context against current definitions; authentication changes still come from the host's authentication provider.

## Order entity gate

Configure context kind **Order**, key property **Id**, and boolean property **Vip**. Bind `ExpressCheckout` to Order and set its ContextProperty condition to Vip equals true.

```razor
<Feature Key="ExpressCheckout" Entity="order">
    <Enabled><button>Express checkout</button></Enabled>
    <Disabled><p>Standard checkout</p></Disabled>
</Feature>

@code {
    private readonly EntityContext order = new("Order", "ord-vip",
        new Dictionary<string, object?> { ["Vip"] = true });
}
```

For a standard order use `Vip=false`. Browser entity gates fail closed without their required entity. Trusted server evaluation passes a canonical `TogglyEvaluationContext` into the .NET SDK. Arbitrary domain objects must first be mapped to the public `EntityContext` shape.

## Prerender and hydration

Use the same component subtree in the server and client projects for Auto. A `FeatureHydration` boundary can carry explicitly public, non-entity boolean results across renderers:

```razor
@using Microsoft.AspNetCore.Components.Web
<FeatureProvider>
    <FeatureHydration PublicKeys="@(new[] { "new-dashboard", "api-v2" })"
                      RenderMode="@(new InteractiveAutoRenderMode())">
        <Feature Key="new-dashboard"><p>New dashboard</p></Feature>
    </FeatureHydration>
</FeatureProvider>
```

`PublicKeys` defaults to empty. The persistent payload contains only allowlisted key/boolean pairs, never backend credentials, definitions, user claims or entity attributes. Only allowlist flags that may be exposed to that browser user. Use a unique `StateKey` for multiple boundaries. Hydration is presentation state, not signed authorization evidence; browser initialization replaces it with independently verified definitions. A context/definition change invalidates it. Entity evaluations are never satisfied by the boolean hydration snapshot.

Static SSR has no interactive event handlers. Interactive Server retains a circuit, WebAssembly runs in the browser, and Auto can select a different runtime on a later visit; it does not transfer a live server DI scope into the browser.

## Filter and telemetry boundaries

| Capability | Trusted Blazor server | Browser |
| --- | --- | --- |
| AlwaysOn, Percentage, Targeting, TimeWindow | Existing .NET native filters | Evaluation endpoint |
| ContextProperty | Existing .NET entity evaluator | Local returned entity gate |
| UserClaims / country / UA / language / device / OS | Not registered by this circuit adapter; custom filters require explicit scoped inputs | Evaluation endpoint; browser headers reflect the actual browser, not demo overrides |
| Live definitions | Trusted provider polling and push notifications | Portable polling and WebSocket invalidation |
| Usage / custom metrics / named variants | Underlying trusted SDK APIs, not new Blazor session methods | No telemetry or variant-assignment API in the portable client |

## Runnable workshop

The [Blazor sample](https://github.com/ops-ai/Toggly.Samples/tree/develop/blazor-sdk) has actual SSR, Server, WebAssembly and Auto routes; declarative/programmatic gates; identity; Order entities; a filter matrix; refresh and failure exercises; and explicit missing-key behavior. Its source-reading map points to the registration, gate, evaluation, authentication and framework boundaries.

## Development

```sh
dotnet test tests/Toggly.FeatureManagement.Blazor.Tests -c Release --collect:"XPlat Code Coverage" --settings coverage.runsettings --results-directory TestResults
python3 check-coverage.py TestResults
bash test-browser.sh
```

Browser verification uses Node 24; no Node runtime is needed by consumers.
The browser verifier is tested against an independent canonical Worker fixture.
The trusted server tests interleave separate users across asynchronous evaluation
and exercise entity forwarding, authentication transitions, reconnect and disposal.

## License

MIT. See [LICENSE](LICENSE). Learn more at [toggly.io](https://toggly.io).
