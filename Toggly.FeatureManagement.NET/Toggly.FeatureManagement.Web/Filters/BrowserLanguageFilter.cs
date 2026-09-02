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
    [FilterAlias("BrowserLanguage")]
    public class BrowserLanguageFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ITargetingContextAccessor _targetingContextAccessor;

        public BrowserLanguageFilter(
            IHttpContextAccessor httpContextAccessor,
            IEnumerable<ITargetingContextAccessor> targetingContextAccessors)
        {
            _httpContextAccessor = httpContextAccessor;
            _targetingContextAccessor = SegmentPercentageGate.ResolveAccessor(targetingContextAccessors);
        }

        public async Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
            var settings = context.Parameters.Get<BrowserLanguageFilterSettings>() ?? new BrowserLanguageFilterSettings();

            if (!await SegmentPercentageGate.PassesAsync(settings.Percentage, context.FeatureName, _targetingContextAccessor).ConfigureAwait(false))
                return false;

            var acceptLanguage = _httpContextAccessor.HttpContext.Request.Headers["Accept-Language"].FirstOrDefault();

            return settings.BrowserLanguage != null &&
                   settings.BrowserLanguage.Any(t => acceptLanguage?.Contains(t, StringComparison.OrdinalIgnoreCase) ?? false);
        }

        public class BrowserLanguageFilterSettings
        {
            public string[] BrowserLanguage { get; set; }

            public short Percentage { get; set; }
        }
    }
}
