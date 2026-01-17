using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.HealthChecks
{
    /// <summary>
    /// Health check for the Toggly Feature Management SDK.
    /// Monitors SDK initialization, definition freshness, WebSocket connectivity, and required feature status.
    /// </summary>
    public class TogglyHealthCheck : IHealthCheck
    {
        private readonly IFeatureProviderDebug _featureProviderDebug;
        private readonly TogglyHealthCheckOptions _options;

        /// <summary>
        /// Creates a new instance of the Toggly health check.
        /// </summary>
        /// <param name="featureDefinitionProvider">The feature definition provider (must implement IFeatureProviderDebug).</param>
        /// <param name="options">Health check configuration options.</param>
        public TogglyHealthCheck(
            IFeatureDefinitionProvider featureDefinitionProvider,
            IOptions<TogglyHealthCheckOptions> options)
        {
            _featureProviderDebug = featureDefinitionProvider as IFeatureProviderDebug
                ?? throw new ArgumentException("Feature definition provider must implement IFeatureProviderDebug", nameof(featureDefinitionProvider));
            _options = options?.Value ?? new TogglyHealthCheckOptions();
        }

        /// <summary>
        /// Performs the health check.
        /// </summary>
        /// <param name="context">The health check context.</param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>The health check result.</returns>
        public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
        {
            var debugInfo = _featureProviderDebug.GetDebugInfo();
            var data = new Dictionary<string, object>();

            // Add diagnostic data if enabled
            if (_options.IncludeDiagnosticData)
            {
                data["appKey"] = debugInfo.AppKey ?? "unknown";
                data["environment"] = debugInfo.Environment ?? "unknown";
                data["definitionCount"] = debugInfo.Definitions?.Count ?? 0;
                data["websocketConnected"] = debugInfo.WebsocketClientRunning;
                data["loaded"] = debugInfo.Loaded;

                if (debugInfo.LastRefresh.HasValue)
                    data["lastRefresh"] = debugInfo.LastRefresh.Value.ToString("O");

                if (!string.IsNullOrEmpty(debugInfo.LastError))
                {
                    data["lastError"] = debugInfo.LastError;
                    if (debugInfo.LastErrorTime.HasValue)
                        data["lastErrorTime"] = debugInfo.LastErrorTime.Value.ToString("O");
                }
            }

            // Check 1: SDK not loaded
            if (!debugInfo.Loaded)
            {
                return Task.FromResult(HealthCheckResult.Unhealthy(
                    "Toggly SDK has not completed initial load",
                    data: data));
            }

            // Check 2: Definition staleness - only stale if WebSocket is disconnected AND definitions are old
            // When WebSocket is connected, updates are pushed in real-time so age doesn't matter
            if (!debugInfo.WebsocketClientRunning)
            {
                var definitionsAge = debugInfo.LastRefresh.HasValue
                    ? DateTime.UtcNow - debugInfo.LastRefresh.Value
                    : TimeSpan.MaxValue;

                if (definitionsAge > _options.StalenessThreshold)
                {
                    data["definitionsAge"] = definitionsAge.ToString();
                    data["stalenessThreshold"] = _options.StalenessThreshold.ToString();

                    return Task.FromResult(HealthCheckResult.Unhealthy(
                        $"Feature definitions are stale ({definitionsAge:g} old) and WebSocket is disconnected",
                        data: data));
                }
            }

            // Check 3: Required features
            var disabledRequiredFeatures = GetDisabledRequiredFeatures(debugInfo);
            if (disabledRequiredFeatures.Any())
            {
                data["disabledRequiredFeatures"] = string.Join(", ", disabledRequiredFeatures);

                var message = $"Required features are disabled: {string.Join(", ", disabledRequiredFeatures)}";

                if (_options.TreatRequiredFeaturesAsUnhealthy)
                {
                    return Task.FromResult(HealthCheckResult.Unhealthy(message, data: data));
                }

                return Task.FromResult(HealthCheckResult.Degraded(message, data: data));
            }

            // Check 4: WebSocket status (informational - not a failure)
            if (!debugInfo.WebsocketClientRunning)
            {
                data["websocketStatus"] = "disconnected";
                // Not degraded if definitions are fresh, but worth noting
            }

            // All checks passed
            return Task.FromResult(HealthCheckResult.Healthy(
                "Toggly SDK is healthy",
                data: data));
        }

        /// <summary>
        /// Gets the list of required features that are currently disabled.
        /// </summary>
        private List<string> GetDisabledRequiredFeatures(FeatureProviderDebugInfo debugInfo)
        {
            var disabledFeatures = new List<string>();

            if (_options.RequiredFeatures == null || !_options.RequiredFeatures.Any())
                return disabledFeatures;

            if (debugInfo.Definitions == null)
            {
                // If definitions are null, all required features are considered disabled
                return _options.RequiredFeatures.ToList();
            }

            foreach (var featureKey in _options.RequiredFeatures)
            {
                if (!debugInfo.Definitions.TryGetValue(featureKey, out var definition))
                {
                    // Feature not found in definitions = disabled
                    disabledFeatures.Add(featureKey);
                    continue;
                }

                // Check if the feature has an AlwaysOn filter (meaning it's enabled)
                var isEnabled = definition.EnabledFor?.Any(f =>
                    f.Name.Equals("AlwaysOn", StringComparison.OrdinalIgnoreCase)) ?? false;

                if (!isEnabled)
                {
                    disabledFeatures.Add(featureKey);
                }
            }

            return disabledFeatures;
        }
    }
}
