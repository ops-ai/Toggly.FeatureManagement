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
    /// <summary>
    /// Feature filter that matches Accept-Language values with an optional sticky percentage gate.
    /// </summary>
    [FilterAlias("BrowserLanguage")]
    public class BrowserLanguageFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ITargetingContextAccessor _targetingContextAccessor;

        /// <summary>
        /// Creates a browser-language filter using the current HTTP context and optional targeting accessors.
        /// </summary>
        /// <param name="httpContextAccessor">Accessor for the current HTTP request.</param>
        /// <param name="targetingContextAccessors">Targeting accessors used for sticky percentage evaluation.</param>
        public BrowserLanguageFilter(
            IHttpContextAccessor httpContextAccessor,
            IEnumerable<ITargetingContextAccessor> targetingContextAccessors)
        {
            _httpContextAccessor = httpContextAccessor;
            _targetingContextAccessor = SegmentPercentageGate.ResolveAccessor(targetingContextAccessors);
        }

        /// <summary>
        /// Evaluates whether the request Accept-Language header matches the configured allow-list and percentage.
        /// </summary>
        /// <param name="context">Feature filter evaluation context.</param>
        /// <returns><c>true</c> when the filter matches; otherwise <c>false</c>.</returns>
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
