using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;

namespace Toggly.FeatureManagement.Filters
{
    /// <summary>
    /// Definitions-aligned targeting filter (replaces stock
    /// <c>Microsoft.Targeting</c>). Default rollout uses
    /// <see cref="Percentile"/> with <c>featureKey\nuserId</c> seed order.
    /// </summary>
    [FilterAlias(Alias)]
    public class TogglyTargetingFilter : IFeatureFilter
    {
        internal const string Alias = "Microsoft.Targeting";

        private static readonly string[] UserPrefixes = { "Audience.Users", "Audience:Users" };
        private static readonly string[] GroupPrefixes = { "Audience.Groups", "Audience:Groups" };
        private static readonly string[] ExclusionUserPrefixes = { "Audience.Exclusion.Users", "Audience:Exclusion:Users" };
        private static readonly string[] ExclusionGroupPrefixes = { "Audience.Exclusion.Groups", "Audience:Exclusion:Groups" };

        private readonly ITargetingContextAccessor? _targetingContextAccessor;

        /// <summary>
        /// Creates the filter, resolving an optional targeting context accessor.
        /// </summary>
        public TogglyTargetingFilter(IServiceProvider serviceProvider)
        {
            _targetingContextAccessor = serviceProvider.GetService<ITargetingContextAccessor>();
        }

        /// <inheritdoc />
        public async Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
            if (context == null)
                throw new ArgumentNullException(nameof(context));

            var parameters = context.Parameters;
            var ignoreCase = parameters.GetValue("IgnoreCase", true);

            string? userId = null;
            IEnumerable<string>? groups = null;

            if (_targetingContextAccessor != null)
            {
                var targetingContext = await _targetingContextAccessor.GetContextAsync().ConfigureAwait(false);
                userId = targetingContext?.UserId;
                groups = targetingContext?.Groups;
            }

            var comparison = ignoreCase ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

            var exclusionUsers = CollectIndexedValues(parameters, ExclusionUserPrefixes);
            if (!string.IsNullOrEmpty(userId) && exclusionUsers.Any(u => userId!.Equals(u, comparison)))
                return false;

            var exclusionGroups = CollectIndexedValues(parameters, ExclusionGroupPrefixes);
            if (groups != null && exclusionGroups.Count > 0 &&
                exclusionGroups.Any(eg => groups.Any(g => g != null && g.Equals(eg, comparison))))
            {
                return false;
            }

            var inclusionUsers = CollectIndexedValues(parameters, UserPrefixes);
            if (!string.IsNullOrEmpty(userId) && inclusionUsers.Any(u => userId!.Equals(u, comparison)))
                return true;

            // Prefer Definitions-style indexed string groups; fall back to MF Audience.Groups names.
            var inclusionGroups = CollectIndexedValues(parameters, GroupPrefixes);
            if (inclusionGroups.Count == 0)
            {
                var settings = parameters.Get<TargetingFilterSettings>();
                if (settings?.Audience?.Groups != null)
                {
                    inclusionGroups = settings.Audience.Groups
                        .Where(g => !string.IsNullOrEmpty(g?.Name))
                        .Select(g => g.Name)
                        .ToList();
                }
            }

            if (groups != null && inclusionGroups.Count > 0 &&
                inclusionGroups.Any(ig => groups.Any(g => g != null && g.Equals(ig, comparison))))
            {
                return true;
            }

            double? rollout = TryGetDouble(parameters, "Audience.DefaultRolloutPercentage");
            if (rollout == null)
                rollout = TryGetDouble(parameters, "Percentage");

            if (rollout == null)
            {
                var settings = parameters.Get<TargetingFilterSettings>();
                if (settings?.Audience != null)
                    rollout = settings.Audience.DefaultRolloutPercentage;
            }

            if (rollout == null || rollout <= 0)
                return false;
            if (rollout >= 100)
                return true;
            if (string.IsNullOrEmpty(userId))
                return false;

            return Percentile.IsInRollout(context.FeatureName, userId!, rollout.Value);
        }

        private static List<string> CollectIndexedValues(IConfiguration parameters, IReadOnlyList<string> prefixes)
        {
            var values = new List<string>();
            foreach (var child in parameters.AsEnumerable())
            {
                if (string.IsNullOrEmpty(child.Key) || child.Value == null)
                    continue;

                foreach (var prefix in prefixes)
                {
                    if (!child.Key.StartsWith(prefix + ":", StringComparison.Ordinal))
                        continue;

                    if (child.Value.Length > 0)
                        values.Add(child.Value);
                    break;
                }
            }

            return values;
        }

        private static double? TryGetDouble(IConfiguration parameters, string key)
        {
            var raw = parameters[key];
            if (string.IsNullOrEmpty(raw))
                return null;
            if (double.TryParse(raw, out var value))
                return value;
            return null;
        }
    }
}
