# ASP.NET Core Feature Flag Extensions for NSwag

Automatically exclude API endpoints from Swagger/OpenAPI documentation when their associated feature flags are disabled. This package integrates Toggly feature flags with NSwag to keep your API documentation in sync with your feature flag state.

## Installation

``` sh
dotnet add package Toggly.FeatureManagement.NSwag
```

## Features

- **Automatic Filtering**: Endpoints with `[FeatureGate]` attributes are automatically excluded from Swagger when their feature flags are disabled
- **Dynamic Updates**: The Swagger document is generated on-demand, so it always reflects the current state of your feature flags
- **Controller & Action Support**: Works with both controller-level and action-level `[FeatureGate]` attributes
- **Requirement Types**: Supports both `RequirementType.All` and `RequirementType.Any` from FeatureGateAttribute

## Usage

### Basic Setup

In your `Startup.cs` or `Program.cs`, add the feature gate filtering to your NSwag configuration:

```csharp
using Toggly.FeatureManagement.NSwag.Configuration;

services.AddOpenApiDocument(config =>
{
    config.Title = "My API";
    config.DocumentName = "v1";
    
    // Add feature gate filtering
    config.AddFeatureGateFiltering(services.BuildServiceProvider());
    
    // ... rest of your NSwag configuration
});
```

### Example Controller

```csharp
using Microsoft.FeatureManagement.Mvc;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/[controller]")]
[FeatureGate(FeatureFlags.ExperimentalFeature)]
public class ExperimentalController : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        return Ok("This endpoint is only visible in Swagger when ExperimentalFeature is enabled");
    }
}
```

### Before

Without this package, all endpoints appear in Swagger regardless of feature flag state. Users might see endpoints in the documentation that are actually disabled, leading to confusion.

### After

With `Toggly.FeatureManagement.NSwag`, endpoints are automatically excluded from Swagger when their feature flags are disabled. The documentation always reflects the current state of your feature flags.

**Dynamic Updates**: The Swagger document is generated on-demand when requested (e.g., when accessing `/swagger/v1/swagger.json`), so you can turn features on/off dynamically without restarting the application, and the Swagger documentation will update accordingly.

## How It Works

1. The `FeatureGateOperationProcessor` examines each API endpoint during Swagger document generation
2. It checks for `[FeatureGate]` attributes on both the controller class and action methods
3. If a `[FeatureGate]` attribute is found, it evaluates the associated feature flags using `IFeatureManager`
4. If the feature flags are disabled (based on `RequirementType`), the endpoint is excluded from the Swagger document
5. The document is generated on-demand, ensuring it always reflects the current feature flag state

## Requirements

- .NET Standard 2.1 or later
- NSwag.AspNetCore 14.6.2 or compatible
- Microsoft.FeatureManagement.AspNetCore 4.3.0 or compatible
- Toggly.FeatureManagement (base package)

## Notes

- Endpoints without `[FeatureGate]` attributes are always included in Swagger
- If `IFeatureManager` is not available in the service provider, endpoints are included by default
- The processor supports both `RequirementType.All` (all features must be enabled) and `RequirementType.Any` (at least one feature must be enabled)
