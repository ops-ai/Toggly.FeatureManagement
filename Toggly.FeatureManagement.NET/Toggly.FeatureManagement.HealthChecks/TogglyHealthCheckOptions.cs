using System;
using System.Collections.Generic;

namespace Toggly.FeatureManagement.HealthChecks
{
    /// <summary>
    /// Configuration options for the Toggly health check.
    /// </summary>
    public class TogglyHealthCheckOptions
    {
        /// <summary>
        /// The maximum age of definitions before they are considered stale.
        /// Definitions are only considered stale when WebSocket is disconnected AND
        /// definitions are older than this threshold. When WebSocket is connected,
        /// updates are pushed in real-time so age doesn't matter.
        /// Default: 10 minutes.
        /// </summary>
        public TimeSpan StalenessThreshold { get; set; } = TimeSpan.FromMinutes(10);

        /// <summary>
        /// A collection of feature keys that must be enabled (have AlwaysOn filter).
        /// If any of these features are disabled, the health check will report Degraded
        /// (or Unhealthy if <see cref="TreatRequiredFeaturesAsUnhealthy"/> is true).
        /// </summary>
        public IEnumerable<string> RequiredFeatures { get; set; } = Array.Empty<string>();

        /// <summary>
        /// If true, disabled required features will cause the health check to report Unhealthy
        /// instead of Degraded. Default: false.
        /// </summary>
        public bool TreatRequiredFeaturesAsUnhealthy { get; set; } = false;

        /// <summary>
        /// If true, include detailed diagnostic information in the health check data.
        /// This includes last error messages, error times, and definition counts.
        /// Default: true.
        /// </summary>
        public bool IncludeDiagnosticData { get; set; } = true;
    }
}
