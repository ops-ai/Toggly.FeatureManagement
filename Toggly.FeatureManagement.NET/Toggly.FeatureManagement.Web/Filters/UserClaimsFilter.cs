using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.Web.Filters
{
    [FilterAlias("UserClaims")]
    public class UserClaimsFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ITargetingContextAccessor _targetingContextAccessor;

        public UserClaimsFilter(
            IHttpContextAccessor httpContextAccessor,
            IEnumerable<ITargetingContextAccessor> targetingContextAccessors)
        {
            _httpContextAccessor = httpContextAccessor;
            _targetingContextAccessor = SegmentPercentageGate.ResolveAccessor(targetingContextAccessors);
        }

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
