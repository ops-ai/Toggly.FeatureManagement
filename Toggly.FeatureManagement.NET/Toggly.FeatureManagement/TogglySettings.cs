using System;
using System.Collections.Generic;

namespace Toggly.FeatureManagement
{
    public class TogglySettings
    {
        /// <summary>
        /// Toggly App Key. Get it from the App Settings page on toggly.io
        /// </summary>
        public string AppKey { get; set; } = string.Empty;

        /// <summary>
        /// Name of the environment. Case sensitive
        /// </summary>
        public string Environment { get; set; } = "Production";

        /// <summary>
        /// Use signed definitions to get feature updates.
        /// Strongly recommended in production when flags gate security-sensitive behavior.
        /// </summary>
        public bool UseSignedDefinitions { get; set; }

        /// <summary>
        /// Base URL for metrics/usage gRPC (trusted configuration). Defaults to https://app.toggly.io/.
        /// Only override for self-hosted or private deployments you control.
        /// </summary>
        public string? BaseUrl { get; set; }

        /// <summary>
        /// Base URL for definitions, WebSocket, and JWKS (trusted configuration).
        /// Defaults to https://definitions.toggly.io/. Only override for deployments you control;
        /// a malicious value can redirect fetch/JWKS traffic (SSRF-style misconfiguration risk).
        /// </summary>
        public string? DefinitionsBaseUrl { get; set; }

        /// <summary>
        /// The current version of the application. Used to track deployments
        /// Assembly version is used if not specified
        /// </summary>
        public string? AppVersion { get; set; }

        /// <summary>
        /// Hostname or instance name of the application. Useful in load-balanced and multi-server setups
        /// Hostname is used if not specified
        /// </summary>
        public string? InstanceName { get; set; }

        /// <summary>
        /// Undefined features should be treated as AlwaysOn on development
        /// (when app.Environment.IsDevelopment() is true)
        /// </summary>
        public bool UndefinedEnabledOnDevelopment { get; set; }

        /// <summary>
        /// Optional whitelist of JWKS key IDs trusted for signed definitions.
        /// </summary>
        public HashSet<string>? AllowedKeyIds { get; set; }

        /// <summary>
        /// How long verified JWKS keys are cached in memory and in the snapshot store.
        /// Default is 30 days. Minimum effective value is 1 minute.
        /// </summary>
        public TimeSpan JwksCacheDuration { get; set; } = TimeSpan.FromDays(30);

        /// <summary>
        /// Optional callback invoked when fetch, cache, signature, JWKS, or storage
        /// operations fail. Use for Sentry/AppInsights or other telemetry.
        /// The last error is also available via <see cref="IFeatureProviderDebug.GetDebugInfo"/>.
        /// </summary>
        public Action<string, Exception?>? OnError { get; set; }

        /// <summary>
        /// When true (default), discovered entity context schemas are registered with Toggly at startup.
        /// Failures are logged and do not block application startup.
        /// </summary>
        public bool RegisterContextsOnStartup { get; set; } = true;
    }
}
