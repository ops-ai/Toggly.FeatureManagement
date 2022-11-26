using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using System;
using System.Linq;
using System.Threading.Tasks;
using UAParser;

namespace Toggly.FeatureManagement.Web.Filters
{
    [FilterAlias("OS")]
    public class OSFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;

        public OSFilter(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
        }

        public Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
            var settings = context.Parameters.Get<OSFilterSettings>() ?? new OSFilterSettings();

            var userAgent = _httpContextAccessor.HttpContext.Request.Headers["User-Agent"];

            var uaParser = Parser.GetDefault();
            var ua = uaParser.Parse(userAgent);

            var result = (RandomGenerator.NextDouble() * 100) < settings.Percentage;
            return Task.FromResult(result && settings.OperatingSystem.Any(t => ua.OS.Family.Contains(t, StringComparison.OrdinalIgnoreCase)));
        }

        public class OSFilterSettings
        {
            public string[] OperatingSystem { get; set; }

            public short Percentage { get; set; }
        }
    }
}
