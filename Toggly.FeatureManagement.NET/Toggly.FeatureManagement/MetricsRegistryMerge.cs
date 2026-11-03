using Microsoft.Extensions.Logging;
using System.Collections.Generic;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Merges metric handler results while skipping entries that lack a usable key.
    /// </summary>
    internal static class MetricsRegistryMerge
    {
        /// <summary>
        /// Copies <paramref name="entries"/> into <paramref name="results"/>, skipping null/empty keys
        /// so one bad entry cannot abort the rest of a handler's observations.
        /// </summary>
        public static void Merge<T>(
            Dictionary<string, T> results,
            IEnumerable<KeyValuePair<string, T>>? entries,
            ILogger logger,
            string metricKind)
        {
            if (entries == null)
            {
                if (logger.IsEnabled(LogLevel.Debug))
                    logger.LogDebug("Skipping {MetricKind} handler that returned null results", metricKind);
                return;
            }

            foreach (var entry in entries)
            {
                if (string.IsNullOrEmpty(entry.Key))
                {
                    if (logger.IsEnabled(LogLevel.Debug))
                        logger.LogDebug("Skipping {MetricKind} entry without a metric key", metricKind);
                    continue;
                }

                results[entry.Key] = entry.Value;
            }
        }
    }
}
