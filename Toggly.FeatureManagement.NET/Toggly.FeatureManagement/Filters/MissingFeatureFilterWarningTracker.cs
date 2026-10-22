#nullable enable

using System;
using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace Toggly.FeatureManagement.Filters
{
    /// <summary>
    /// Emits one warning per missing filter configuration name per process.
    /// </summary>
    public sealed class MissingFeatureFilterWarningTracker
    {
        private readonly ConcurrentDictionary<string, byte> _warned =
            new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);
        private readonly ILogger<MissingFeatureFilterWarningTracker> _logger;

        public MissingFeatureFilterWarningTracker(ILogger<MissingFeatureFilterWarningTracker> logger)
        {
            _logger = logger;
        }

        /// <summary>
        /// Logs when <paramref name="configurationName"/> is not registered.
        /// </summary>
        public void WarnIfMissing(string configurationName, FeatureFilterRegistrationIndex registrationIndex)
        {
            if (string.IsNullOrEmpty(configurationName) || registrationIndex.IsRegistered(configurationName))
                return;

            if (!_warned.TryAdd(configurationName, 0))
                return;

            _logger.LogWarning(
                "Feature filter '{FilterName}' is not registered; evaluation will fail closed (throws when IgnoreMissingFeatureFilters is false). " +
                "Register the filter implementation or correct the feature definition filter name.",
                configurationName);
        }
    }
}
