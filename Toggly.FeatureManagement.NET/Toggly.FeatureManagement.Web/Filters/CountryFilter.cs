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
    /// Feature filter that matches Cloudflare CF-IPCountry (or equivalent) with an optional sticky percentage gate.
    /// </summary>
    [FilterAlias("CountryFamily")]
    public class CountryFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ITargetingContextAccessor _targetingContextAccessor;

        /// <summary>
        /// Creates a country filter using the current HTTP context and optional targeting accessors.
        /// </summary>
        /// <param name="httpContextAccessor">Accessor for the current HTTP request.</param>
        /// <param name="targetingContextAccessors">Targeting accessors used for sticky percentage evaluation.</param>
        public CountryFilter(
            IHttpContextAccessor httpContextAccessor,
            IEnumerable<ITargetingContextAccessor> targetingContextAccessors)
        {
            _httpContextAccessor = httpContextAccessor;
            _targetingContextAccessor = SegmentPercentageGate.ResolveAccessor(targetingContextAccessors);
        }

        /// <summary>
        /// Evaluates whether the request country matches the configured allow-list and percentage.
        /// </summary>
        /// <param name="context">Feature filter evaluation context.</param>
        /// <returns><c>true</c> when the filter matches; otherwise <c>false</c>.</returns>
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
