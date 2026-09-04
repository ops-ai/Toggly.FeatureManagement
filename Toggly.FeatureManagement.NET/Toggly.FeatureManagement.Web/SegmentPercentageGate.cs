using System.Linq;
using System.Threading.Tasks;
using Microsoft.FeatureManagement.FeatureFilters;

namespace Toggly.FeatureManagement.Web
{
    /// <summary>
    /// Segment nested-% gate: sticky <see cref="Percentile"/> when a targeting
    /// user id is available; otherwise non-sticky <see cref="RandomGenerator"/>.
    /// </summary>
    static class SegmentPercentageGate
    {
        public static async Task<bool> PassesAsync(
            short percentage,
            string featureName,
            ITargetingContextAccessor targetingContextAccessor)
        {
            if (percentage <= 0)
                return false;
            if (percentage >= 100)
                return true;

            string userId = null;
            if (targetingContextAccessor != null)
            {
                var targetingContext = await targetingContextAccessor.GetContextAsync().ConfigureAwait(false);
                userId = targetingContext?.UserId;
            }

            if (!string.IsNullOrEmpty(userId))
                return Percentile.IsInRollout(featureName, userId, percentage);

            return (RandomGenerator.NextDouble() * 100) < percentage;
        }

        public static ITargetingContextAccessor ResolveAccessor(
            System.Collections.Generic.IEnumerable<ITargetingContextAccessor> accessors)
        {
            return accessors?.FirstOrDefault();
        }
    }
}
