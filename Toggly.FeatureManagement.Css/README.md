<p align="center">
  <img src="assets/Github-banner.png">
</p>


Enables teams to release software faster and safer, and with better results. Focus on what's most important, release at a time of your choosing. 

Toggly is a feature flags service that lets you quickly turn features on/off or rollout to a subset of users without having to redeploy your app, view metrics on feature usage, and run experiments to see how a feature affects your business metrics.

Get started in 5 minutes with our Always Free, Forever! Plan at https://toggly.io

# ASP.NET Core Feature Flags with Toggly

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=ops-ai_toggly-feature-management&metric=alert_status)](https://sonarcloud.io/dashboard?id=ops-ai_toggly-feature-management)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=ops-ai_toggly-feature-management&metric=vulnerabilities)](https://sonarcloud.io/dashboard?id=ops-ai_toggly-feature-management)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=ops-ai_toggly-feature-management&metric=coverage)](https://sonarcloud.io/dashboard?id=ops-ai_toggly-feature-management)
![CodeQL](https://github.com/ops-ai/Toggly.FeatureManagement/workflows/CodeQL/badge.svg)
[![Nuget](https://badgen.net/nuget/v/Toggly.FeatureManagement/latest)](https://www.nuget.org/packages/Toggly.FeatureManagement/)

Feature flags provide a way for ASP.NET Core applications to turn features on or off dynamically. Developers can use feature flags in simple use cases like conditional statements to more advanced scenarios like conditionally adding routes or MVC filters. Feature flags build on top of the .NET Core configuration system. Any .NET Core configuration provider is capable of acting as the back-bone for feature flags.

Here are some of the benefits of using this library:

* Built on https://github.com/microsoft/FeatureManagement-Dotnet
* A common convention for feature management
* Feature Flag lifetime management
  * Configuration values can change in real-time, feature flags can be consistent across the entire request
* Simple to Complex Scenarios Covered
  * Toggle on/off features through declarative configuration file
  * Dynamically evaluate state of feature based on call to server
* API extensions for ASP.NET Core and MVC framework
  * Routing
  * Filters
  * Action Attributes

**API Reference**: https://go.microsoft.com/fwlink/?linkid=2091700

### Feature Flags
Feature flags are composed of two parts, a name and a list of feature-filters that are used to turn the feature on.

### Feature Filters
Feature filters define a scenario for when a feature should be enabled. When a feature is evaluated for whether it is on or off, its list of feature-filters are traversed until one of the filters decides the feature should be enabled. At this point the feature is considered enabled and traversal through the feature filters stops. If no feature filter indicates that the feature should be enabled, then it will be considered disabled.

As an example, a Microsoft Edge browser feature filter could be designed. This feature filter would activate any features it is attached to as long as an HTTP request is coming from Microsoft Edge.

## Registration

The .NET Core `TogglyFeatureProvider` is used to retrieve the latest feature flag configuration from toggly.

### Referencing

To make it easier to reference these feature flags in code, we recommend to define feature flag variables like below.

``` C#
// Define feature flags in an enum
public enum MyFeatureFlags
{
    FeatureT,
    FeatureU,
    FeatureV
}
```
    
### Service Registration

Feature flags rely on .NET Core dependency injection. We can register the feature management services using standard conventions.

``` C#
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;

public class Startup
{
  public void ConfigureServices(IServiceCollection services)
  {
      services.AddFeatureManagement()
              .AddFeatureFilter<PercentageFilter>()
              .AddFeatureFilter<TimeWindowFilter>();
  }
}
```
### Adding the Toggly Feature Provider

Add a section to your configuration provider, ex: appsettings.json (or environment variables, key vault, etc)

``` JavaScript
"Toggly": {
    "AppKey": "[[toggly app key]]",
    "Environment": "Production",
    "BaseUrl": "https://app.toggly.io/"
  }
```

In your Startup.cs, register the Toggly Feature Provider
``` C#
builder.Services.AddOptions();
builder.Services.Configure<TogglySettings>(builder.Configuration.GetSection("Toggly"));

builder.Services.AddSingleton<IFeatureDefinitionProvider, TogglyFeatureProvider>();

```

## Consumption
The simplest use case for feature flags is to do a conditional check for whether a feature is enabled to take different paths in code. The uses cases grow from there as the feature flag API begins to offer extensions into ASP.NET Core.

### Feature Check
The basic form of feature management is checking if a feature is enabled and then performing actions based on the result. This is done through the `IFeatureManager`'s `IsEnabledAsync` method.

``` C#
IFeatureManager featureManager;

if (await featureManager.IsEnabledAsync(nameof(MyFeatureFlags.FeatureU)))
{
    // Do something
}
```

### Dependency Injection

When using the feature management library with MVC, the `IFeatureManager` can be obtained through dependency injection.

``` C#
public class HomeController : Controller
{
    private readonly IFeatureManager _featureManager;
    
    public HomeController(IFeatureManager featureManager)
    {
        _featureManager = featureManager;
    }
}
```


### Controllers and Actions
MVC controller and actions can require that a given feature, or one of any list of features, be enabled in order to execute. This can be done by using a `FeatureGateAttribute`, which can be found in the `Microsoft.FeatureManagement.Mvc` namespace. 

``` C#
[FeatureGate(MyFeatureFlags.FeatureX)]
public class HomeController : Controller
{
    ...
}
```

The `HomeController` above is gated by "FeatureX". "FeatureX" must be enabled before any action the `HomeController` contains can be executed. 

``` C#
[FeatureGate(MyFeatureFlags.FeatureY)]
public IActionResult Index()
{
    return View();
}
```

The `Index` MVC action above requires "FeatureY" to be enabled before it can execute. 

### Disabled Action Handling

When an MVC controller or action is blocked because none of the features it specifies are enabled, a registered `IDisabledFeaturesHandler` will be invoked. By default, a minimalistic handler is registered which returns HTTP 404. This can be overridden using the `IFeatureManagementBuilder` when registering feature flags.

``` C#
public interface IDisabledFeaturesHandler
{
    Task HandleDisabledFeature(IEnumerable<string> features, ActionExecutingContext context);
}
```

### View

In MVC views `<feature>` tags can be used to conditionally render content based on whether a feature is enabled or not.

``` HTML+Razor
<feature name=@nameof(MyFeatureFlags.FeatureX)>
  <p>This can only be seen if 'FeatureX' is enabled.</p>
</feature>
```

The `<feature>` tag requires a tag helper to work. This can be done by adding the feature management tag helper to the _ViewImports.cshtml_ file.
``` HTML+Razor
@addTagHelper *, Microsoft.FeatureManagement.AspNetCore
```

### MVC Filters

MVC action filters can be set up to conditionally execute based on the state of a feature. This is done by registering MVC filters in a feature aware manner.
The feature management pipeline supports async MVC Action filters, which implement `IAsyncActionFilter`.

``` C#
services.AddMvc(o => 
{
    o.Filters.AddForFeature<SomeMvcFilter>(nameof(MyFeatureFlags.FeatureV));
});
```

The code above adds an MVC filter named `SomeMvcFilter`. This filter is only triggered within the MVC pipeline if the feature it specifies, "FeatureV", is enabled.

### Application building

The feature management library can be used to add application branches and middleware that execute conditionally based on feature state.

``` C#
app.UseMiddlewareForFeature<ThirdPartyMiddleware>(nameof(MyFeatureFlags.FeatureU));
```

With the above call, the application adds a middleware component that only appears in the request pipeline if the feature "FeatureU" is enabled. If the feature is enabled/disabled during runtime, the middleware pipeline can be changed dynamically.

This builds off the more generic capability to branch the entire application based on a feature.

``` C#
app.UseForFeature(featureName, appBuilder => 
{
    appBuilder.UseMiddleware<T>();
});
```


### Missing Feature Filters

If a feature is configured to be enabled for a specific feature filter and that feature filter hasn't been registered, then an exception will be thrown when the feature is evaluated. The exception can be disabled by using the feature management options. 

``` C#
services.Configure<FeatureManagementOptions>(options =>
{
    options.IgnoreMissingFeatureFilters = true;
});
```

### Using HttpContext

Feature filters can evaluate whether a feature should be enabled based off the properties of an HTTP Request. This is performed by inspecting the HTTP Context. A feature filter can get a reference to the HTTP Context by obtaining an `IHttpContextAccessor` through dependency injection.

``` C#
public class BrowserFilter : IFeatureFilter
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public BrowserFilter(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor ?? throw new ArgumentNullException(nameof(httpContextAccessor));
    }
}
```

The `IHttpContextAccessor` must be added to the dependency injection container on startup for it to be available. It can be registered in the `IServiceCollection` using the following method.

``` C#
public void ConfigureServices(IServiceCollection services)
{
    ...
    services.TryAddSingleton<IHttpContextAccessor, HttpContextAccessor>();
    ...
}
```

## Providing a Context For Feature Evaluation

In console applications there is no ambient context such as `HttpContext` that feature filters can acquire and utilize to check if a feature should be on or off. In this case, applications need to provide an object representing a context into the feature management system for use by feature filters. This is done by using `IFeatureManager.IsEnabledAsync<TContext>(string featureName, TContext appContext)`. The appContext object that is provided to the feature manager can be used by feature filters to evaluate the state of a feature.

``` C#
MyAppContext context = new MyAppContext
{
    AccountId = current.Id;
}

if (await featureManager.IsEnabledAsync(feature, context))
{
    ...
}
```
