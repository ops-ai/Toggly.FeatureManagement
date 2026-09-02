using System;
using System.Security.Cryptography;
using System.Text;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Definitions-aligned sticky percentile buckets for Percentage, Targeting default
    /// rollout, and segment nested percentage gates.
    /// </summary>
    /// <remarks>
    /// Canonical contract (same as Cloudflare Definitions / toggly-eval / Go):
    /// UTF-8 encode <c>${featureKey}\n${userId}</c>, SHA-256, interpret the first
    /// 4 bytes as little-endian <see cref="uint"/>, then
    /// <c>(value / uint.MaxValue) * 100</c> → bucket in <c>[0, 100)</c>.
    /// This is the reverse of stock Microsoft.FeatureManagement targeting, which
    /// hashes <c>${userId}\n${hint}</c>.
    /// </remarks>
    public static class Percentile
    {
        /// <summary>
        /// Computes the sticky bucket in <c>[0, 100)</c> for a feature key and user id.
        /// </summary>
        /// <param name="featureKey">Feature / flag key (hashed first).</param>
        /// <param name="userId">Targeting user identifier (hashed second).</param>
        /// <returns>Bucket in <c>[0, 100)</c>.</returns>
        public static double Compute(string featureKey, string userId)
        {
#if NET6_0_OR_GREATER
            ArgumentNullException.ThrowIfNull(featureKey);
            ArgumentNullException.ThrowIfNull(userId);
#else
            if (featureKey == null)
                throw new ArgumentNullException(nameof(featureKey));
            if (userId == null)
                throw new ArgumentNullException(nameof(userId));
#endif

            var input = Encoding.UTF8.GetBytes(featureKey + "\n" + userId);
#if NET6_0_OR_GREATER
            var hash = SHA256.HashData(input);
#else
            using var sha = SHA256.Create();
            var hash = sha.ComputeHash(input);
#endif

            // Little-endian uint32 of the first 4 digest bytes (architecture-independent).
            uint value = (uint)(hash[0] | (hash[1] << 8) | (hash[2] << 16) | (hash[3] << 24));
            return (value / (double)uint.MaxValue) * 100d;
        }

        /// <summary>
        /// Returns whether <paramref name="userId"/> is in the rollout for
        /// <paramref name="featureKey"/> given a percentage threshold.
        /// </summary>
        /// <param name="featureKey">Feature / flag key.</param>
        /// <param name="userId">Targeting user identifier.</param>
        /// <param name="percentage">Rollout percentage in <c>[0, 100]</c>.</param>
        /// <returns>
        /// <c>false</c> when percentage ≤ 0; <c>true</c> when percentage ≥ 100;
        /// otherwise <c>Compute(featureKey, userId) &lt; percentage</c>.
        /// </returns>
        public static bool IsInRollout(string featureKey, string userId, double percentage)
        {
            if (percentage <= 0)
                return false;
            if (percentage >= 100)
                return true;

            return Compute(featureKey, userId) < percentage;
        }
    }
}
