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
    [FilterAlias("DeviceType")]
    public class DeviceTypeFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ITargetingContextAccessor _targetingContextAccessor;

        public DeviceTypeFilter(
            IHttpContextAccessor httpContextAccessor,
            IEnumerable<ITargetingContextAccessor> targetingContextAccessors)
        {
            _httpContextAccessor = httpContextAccessor;
            _targetingContextAccessor = SegmentPercentageGate.ResolveAccessor(targetingContextAccessors);
        }

        public async Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
            var settings = context.Parameters.Get<DeviceTypeFilterSettings>() ?? new DeviceTypeFilterSettings();

            if (!await SegmentPercentageGate.PassesAsync(settings.Percentage, context.FeatureName, _targetingContextAccessor).ConfigureAwait(false))
                return false;

            var userAgent = _httpContextAccessor.HttpContext.Request.Headers["User-Agent"];

            var uaParser = Parser.GetDefault();
            var ua = uaParser.Parse(userAgent);

            return settings.DeviceType != null &&
                   settings.DeviceType.Any(t => ua.Device.Family.Contains(t, StringComparison.OrdinalIgnoreCase));
        }

        public class DeviceTypeFilterSettings
        {
            public string[] DeviceType { get; set; }

            public short Percentage { get; set; }
        }
    }
}
