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
        /// Use signed definitions to get feature updates
        /// </summary>
        public bool UseSignedDefinitions { get; set; }

        /// <summary>
        /// Base URL of the toggly instance. Leave blank unless you have a reason to change
        /// </summary>
        public string? BaseUrl { get; set; }

        /// <summary>
        /// Base URL for definitions and JWKS. Defaults to the Cloudflare worker.
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
        /// New property for whitelisting
        /// </summary>
        public HashSet<string>? AllowedKeyIds { get; set; }

        /// <summary>
        /// Optional callback invoked when fetch, cache, signature, JWKS, or storage
        /// operations fail. Use for Sentry/AppInsights or other telemetry.
        /// The last error is also available via <see cref="IFeatureProviderDebug.GetDebugInfo"/>.
        /// </summary>
        public Action<string, Exception?>? OnError { get; set; }
    }
}
