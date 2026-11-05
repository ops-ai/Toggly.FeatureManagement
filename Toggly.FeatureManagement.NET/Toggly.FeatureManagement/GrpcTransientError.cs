using Grpc.Core;
using System;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Classifies gRPC failures that are typically transient network/server blips
    /// so callers can log them at Warning with backoff instead of Error.
    /// </summary>
    internal static class GrpcTransientError
    {
        private static readonly TimeSpan MinBackoff = TimeSpan.FromMinutes(1);
        private static readonly TimeSpan MaxBackoff = TimeSpan.FromMinutes(30);

        /// <summary>
        /// Minimum spacing between Warning logs for consecutive transient failures.
        /// Kept longer than and independent of the retry backoff so a timer tick
        /// that fires after <see cref="GetBackoffDelay"/> does not immediately re-log.
        /// </summary>
        internal static readonly TimeSpan WarningLogInterval = TimeSpan.FromMinutes(5);

        /// <summary>
        /// Returns true for statuses that usually clear on retry. <see cref="StatusCode.Cancelled"/>
        /// is treated as transient only while the host is not shutting down.
        /// </summary>
        public static bool IsTransient(RpcException exception, bool shuttingDown)
        {
#if NET6_0_OR_GREATER
            ArgumentNullException.ThrowIfNull(exception);
#else
            if (exception == null) throw new ArgumentNullException(nameof(exception));
#endif

            return exception.StatusCode switch
            {
                StatusCode.DeadlineExceeded => true,
                StatusCode.Unavailable => true,
                StatusCode.ResourceExhausted => true,
                StatusCode.Cancelled => !shuttingDown,
                _ => false
            };
        }

        /// <summary>
        /// Exponential backoff for the n-th consecutive transient failure (1-based).
        /// Caps at 30 minutes.
        /// </summary>
        public static TimeSpan GetBackoffDelay(int consecutiveTransientFailures)
        {
            if (consecutiveTransientFailures <= 0)
                return MinBackoff;

            // 1 -> 1m, 2 -> 2m, 3 -> 4m, ... capped at MaxBackoff
            var exponent = Math.Min(consecutiveTransientFailures - 1, 5);
            var minutes = Math.Min(MaxBackoff.TotalMinutes, MinBackoff.TotalMinutes * Math.Pow(2, exponent));
            return TimeSpan.FromMinutes(minutes);
        }

        /// <summary>
        /// Tracks consecutive transient failures and whether the next Warning should be emitted.
        /// </summary>
        internal sealed class BackoffState
        {
            private int _consecutiveFailures;
            private DateTime _nextLogUtc = DateTime.MinValue;

            public int ConsecutiveFailures => _consecutiveFailures;

            public void Reset()
            {
                _consecutiveFailures = 0;
                _nextLogUtc = DateTime.MinValue;
            }

            /// <summary>
            /// Records a transient failure. Returns true when a Warning should be logged now,
            /// and the delay to apply before the next send attempt.
            /// </summary>
            public (bool ShouldLog, TimeSpan Delay) RecordFailure()
            {
                _consecutiveFailures++;
                var delay = GetBackoffDelay(_consecutiveFailures);
                var now = DateTime.UtcNow;
                var shouldLog = now >= _nextLogUtc;
                if (shouldLog)
                    _nextLogUtc = now.Add(WarningLogInterval);
                return (shouldLog, delay);
            }
        }
    }
}
