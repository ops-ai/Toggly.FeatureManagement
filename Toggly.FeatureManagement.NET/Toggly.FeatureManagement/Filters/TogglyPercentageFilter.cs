using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;

namespace Toggly.FeatureManagement.Filters
{
    /// <summary>
    /// Definitions-aligned sticky percentage filter (replaces stock
    /// <c>Microsoft.Percentage</c>, which uses a non-sticky random roll).
    /// Fail closed when no targeting user id is available.
    /// </summary>
    [FilterAlias(Alias)]
    public class TogglyPercentageFilter : IFeatureFilter
    {
        internal const string Alias = "Microsoft.Percentage";

        private readonly ITargetingContextAccessor? _targetingContextAccessor;

        /// <summary>
        /// Creates the filter, resolving an optional targeting context accessor.
        /// </summary>
        public TogglyPercentageFilter(IServiceProvider serviceProvider)
        {
            _targetingContextAccessor = serviceProvider.GetService<ITargetingContextAccessor>();
        }

        /// <inheritdoc />
        public async Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
#if NET6_0_OR_GREATER
            ArgumentNullException.ThrowIfNull(context);
#else
            if (context == null)
                throw new ArgumentNullException(nameof(context));
#endif

            var settings = context.Parameters.Get<PercentageFilterSettings>() ?? new PercentageFilterSettings();
            if (settings.Value <= 0)
                return false;
            if (settings.Value >= 100)
                return true;

            var userId = await ResolveUserIdAsync().ConfigureAwait(false);
            if (string.IsNullOrEmpty(userId))
                return false;

            return Percentile.IsInRollout(context.FeatureName, userId, settings.Value);
        }

        private async Task<string?> ResolveUserIdAsync()
        {
            if (_targetingContextAccessor == null)
                return null;

            var targetingContext = await _targetingContextAccessor.GetContextAsync().ConfigureAwait(false);
            return targetingContext?.UserId;
        }
    }
}
