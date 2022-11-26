using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using System;
using System.Linq;
using System.Threading.Tasks;
using UAParser;

namespace Toggly.FeatureManagement.Web.Filters
{
    [FilterAlias("DeviceType")]
    public class DeviceTypeFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;

        public DeviceTypeFilter(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
        }

        public Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
            var settings = context.Parameters.Get<DeviceTypeFilterSettings>() ?? new DeviceTypeFilterSettings();

            var userAgent = _httpContextAccessor.HttpContext.Request.Headers["User-Agent"];

            var uaParser = Parser.GetDefault();
            var ua = uaParser.Parse(userAgent);

            var result = (RandomGenerator.NextDouble() * 100) < settings.Percentage;
            return Task.FromResult(result && settings.DeviceType.Any(t => ua.Device.Family.Contains(t, StringComparison.OrdinalIgnoreCase)));
        }

        public class DeviceTypeFilterSettings
        {
            public string[] DeviceType { get; set; }

            public short Percentage { get; set; }
        }
    }
}
