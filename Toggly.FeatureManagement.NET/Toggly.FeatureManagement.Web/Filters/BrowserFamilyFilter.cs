using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using UAParser;

namespace Toggly.FeatureManagement.Web.Filters
{
    /// <summary>
    /// Feature filter that matches the request User-Agent browser family with an optional sticky percentage gate.
    /// </summary>
    [FilterAlias("BrowserFamily")]
    public class BrowserFamilyFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ITargetingContextAccessor _targetingContextAccessor;

        /// <summary>
        /// Creates a browser-family filter using the current HTTP context and optional targeting accessors.
        /// </summary>
        /// <param name="httpContextAccessor">Accessor for the current HTTP request.</param>
        /// <param name="targetingContextAccessors">Targeting accessors used for sticky percentage evaluation.</param>
        public BrowserFamilyFilter(
            IHttpContextAccessor httpContextAccessor,
            IEnumerable<ITargetingContextAccessor> targetingContextAccessors)
        {
            _httpContextAccessor = httpContextAccessor;
            _targetingContextAccessor = SegmentPercentageGate.ResolveAccessor(targetingContextAccessors);
        }

        /// <summary>
        /// Evaluates whether the current request's browser family matches the configured allow-list and percentage.
        /// </summary>
        /// <param name="context">Feature filter evaluation context.</param>
        /// <returns><c>true</c> when the filter matches; otherwise <c>false</c>.</returns>
        public async Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
            var settings = context.Parameters.Get<BrowserFamilyFilterSettings>() ?? new BrowserFamilyFilterSettings();

            if (!await SegmentPercentageGate.PassesAsync(settings.Percentage, context.FeatureName, _targetingContextAccessor).ConfigureAwait(false))
                return false;

            var userAgent = _httpContextAccessor.HttpContext.Request.Headers["User-Agent"];

            var uaParser = Parser.GetDefault();
            var ua = uaParser.Parse(userAgent);

            return settings.BrowserFamily != null &&
                   settings.BrowserFamily.Any(t => ua.UA.Family.Contains(t, StringComparison.OrdinalIgnoreCase));
        }

        public class BrowserFamilyFilterSettings
        {
            public string[] BrowserFamily { get; set; }

            public short Percentage { get; set; }
        }
    }
}
