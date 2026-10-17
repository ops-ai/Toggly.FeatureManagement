using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Default <see cref="IFeatureUsageScope"/> implementation.
    /// Usage count is recorded when the scope is created.
    /// </summary>
    internal sealed class FeatureUsageScope : IFeatureUsageScope
    {
        private readonly TogglyUsageStatsProvider _provider;
        private readonly IReadOnlyList<string> _featureKeys;
        private readonly Stopwatch _stopwatch;
        private bool _failed;
        private bool _cancelled;
        private bool _completed;

        internal FeatureUsageScope(TogglyUsageStatsProvider provider, IReadOnlyList<string> featureKeys)
        {
            _provider = provider;
            _featureKeys = featureKeys;
            _stopwatch = Stopwatch.StartNew();
        }

        /// <inheritdoc/>
        public void Fail() => _failed = true;

        /// <inheritdoc/>
        public void MarkCancelled() => _cancelled = true;

        /// <inheritdoc/>
        public void Dispose()
        {
            Complete();
            GC.SuppressFinalize(this);
        }

        /// <inheritdoc/>
        public ValueTask DisposeAsync()
        {
            Complete();
            GC.SuppressFinalize(this);
            return default;
        }

        private void Complete()
        {
            if (_completed)
                return;
            _completed = true;
            _stopwatch.Stop();
            // Whole milliseconds; sub-ms scopes contribute 0 and skip the duration add (matches other SDKs).
            var durationMs = Math.Max(0, _stopwatch.ElapsedMilliseconds);

            foreach (var featureKey in _featureKeys)
            {
                if (_cancelled)
                    continue;
                if (_failed)
                    _provider.RecordUsageScopeFailure(featureKey, durationMs);
                else
                    _provider.RecordUsageScopeSuccess(featureKey, durationMs);
            }
        }
    }
}
