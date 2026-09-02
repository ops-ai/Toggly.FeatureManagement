using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.Web.Filters
{
    [FilterAlias("CountryFamily")]
    public class CountryFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ITargetingContextAccessor _targetingContextAccessor;

        public CountryFilter(
            IHttpContextAccessor httpContextAccessor,
            IEnumerable<ITargetingContextAccessor> targetingContextAccessors)
        {
            _httpContextAccessor = httpContextAccessor;
            _targetingContextAccessor = SegmentPercentageGate.ResolveAccessor(targetingContextAccessors);
        }

        public async Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
            var settings = context.Parameters.Get<CountryFilterSettings>() ?? new CountryFilterSettings();

            if (!await SegmentPercentageGate.PassesAsync(settings.Percentage, context.FeatureName, _targetingContextAccessor).ConfigureAwait(false))
                return false;

            var ipCountry = _httpContextAccessor.HttpContext.Request.Headers["CF-IPCountry"];

            return settings.Country != null &&
                   settings.Country.Any(t => t.Equals(ipCountry, StringComparison.OrdinalIgnoreCase));
        }

        public class CountryFilterSettings
        {
            public string[] Country { get; set; }

            public short Percentage { get; set; }
        }
    }
}
