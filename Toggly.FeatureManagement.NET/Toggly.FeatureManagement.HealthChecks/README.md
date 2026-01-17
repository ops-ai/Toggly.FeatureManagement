# Toggly.FeatureManagement.HealthChecks

ASP.NET Core Health Checks for the Toggly Feature Management SDK. Monitor SDK connection status, definition freshness, WebSocket connectivity, and required feature availability.

## Installation

```bash
dotnet add package Toggly.FeatureManagement.HealthChecks
```

## Quick Start

```csharp
builder.Services.AddHealthChecks()
    .AddTogglyHealthCheck();
```

## Configuration

### Basic Configuration

```csharp
builder.Services.AddHealthChecks()
    .AddTogglyHealthCheck(options =>
    {
        // Maximum age of definitions before considered stale (default: 10 minutes)
        options.StalenessThreshold = TimeSpan.FromMinutes(15);
        
        // Features that must be enabled for the service to be healthy
        options.RequiredFeatures = new[] { "critical-feature", "payment-gateway" };
        
        // If true, disabled required features = Unhealthy instead of Degraded
        options.TreatRequiredFeaturesAsUnhealthy = false;
        
        // Include detailed diagnostic data in health check response
        options.IncludeDiagnosticData = true;
    });
```

### With Required Features (Shorthand)

```csharp
builder.Services.AddHealthChecks()
    .AddTogglyHealthCheck(
        requiredFeatures: new[] { "critical-feature", "payment-gateway" },
        name: "toggly-features");
```

### Custom Name and Tags

```csharp
builder.Services.AddHealthChecks()
    .AddTogglyHealthCheck(
        name: "toggly-sdk",
        tags: new[] { "ready", "live" },
        failureStatus: HealthStatus.Degraded);
```

## Health Check Behavior

The health check reports three possible states:

### Healthy

- SDK has loaded successfully
- Definitions are fresh (within staleness threshold)
- All required features are enabled

### Degraded

- Required features are disabled (when `TreatRequiredFeaturesAsUnhealthy` is false)

### Unhealthy

- SDK has not completed initial load
- Definitions are stale (WebSocket disconnected AND definitions older than threshold)
- Required features are disabled (when `TreatRequiredFeaturesAsUnhealthy` is true)

## Response Data

When `IncludeDiagnosticData` is enabled (default), the health check includes:

| Field | Description |
|-------|-------------|
| `appKey` | The configured Toggly app key |
| `environment` | The configured environment name |
| `definitionCount` | Number of loaded feature definitions |
| `websocketConnected` | Whether the WebSocket for live updates is connected |
| `loaded` | Whether the SDK has completed initial load |
| `lastRefresh` | Timestamp of last successful definition refresh |
| `lastError` | Most recent error message (if any) |
| `lastErrorTime` | Timestamp of most recent error (if any) |
| `definitionsAge` | Age of definitions (when stale) |
| `disabledRequiredFeatures` | List of required features that are disabled |

## Example Response

```json
{
  "status": "Healthy",
  "results": {
    "toggly": {
      "status": "Healthy",
      "description": "Toggly SDK is healthy",
      "data": {
        "appKey": "my-app-key",
        "environment": "Production",
        "definitionCount": 15,
        "websocketConnected": true,
        "loaded": true,
        "lastRefresh": "2024-01-15T10:30:00.0000000Z"
      }
    }
  }
}
```

## Integration with Kubernetes

Use the health check for Kubernetes probes:

```csharp
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready")
});

app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("live")
});
```

```csharp
builder.Services.AddHealthChecks()
    .AddTogglyHealthCheck(
        name: "toggly",
        tags: new[] { "ready" });
```

## Requirements

- .NET Standard 2.1+ / .NET Core 3.1+ / .NET 5.0+
- Toggly.FeatureManagement SDK configured and registered

## License

MIT License - see [LICENSE](LICENSE) for details.
