using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.Web.Filters
{
    /// <summary>
    /// Feature filter that matches a principal claim type/value with an optional sticky percentage gate.
    /// </summary>
    [FilterAlias("UserClaims")]
    public class UserClaimsFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ITargetingContextAccessor _targetingContextAccessor;

        /// <summary>
        /// Creates a user-claims filter using the current HTTP context and optional targeting accessors.
        /// </summary>
        /// <param name="httpContextAccessor">Accessor for the current HTTP request.</param>
        /// <param name="targetingContextAccessors">Targeting accessors used for sticky percentage evaluation.</param>
        public UserClaimsFilter(
            IHttpContextAccessor httpContextAccessor,
            IEnumerable<ITargetingContextAccessor> targetingContextAccessors)
        {
            _httpContextAccessor = httpContextAccessor;
            _targetingContextAccessor = SegmentPercentageGate.ResolveAccessor(targetingContextAccessors);
        }

        /// <summary>
        /// Evaluates whether the current user has the configured claim and passes the percentage gate.
        /// </summary>
        /// <param name="context">Feature filter evaluation context.</param>
        /// <returns><c>true</c> when the filter matches; otherwise <c>false</c>.</returns>
        public async Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
            UserClaimsFilterSettings settings = context.Parameters.Get<UserClaimsFilterSettings>() ?? new UserClaimsFilterSettings();

            if (!await SegmentPercentageGate.PassesAsync(settings.Percentage, context.FeatureName, _targetingContextAccessor).ConfigureAwait(false))
                return false;

            return _httpContextAccessor.HttpContext?.User?.HasClaim(settings.Claim, settings.Value) ?? false;
        }
    }

    public class UserClaimsFilterSettings
    {
        public string Claim { get; set; }

        public string Value { get; set; }

        public short Percentage { get; set; }
    }
}
