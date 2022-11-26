using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using System;
using System.Linq;
using System.Threading.Tasks;
using UAParser;

namespace Toggly.FeatureManagement.Web.Filters
{
    [FilterAlias("BrowserFamily")]
    public class BrowserFamilyFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;

        public BrowserFamilyFilter(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
        }

        public Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
            var settings = context.Parameters.Get<BrowserFamilyFilterSettings>() ?? new BrowserFamilyFilterSettings();

            var userAgent = _httpContextAccessor.HttpContext.Request.Headers["User-Agent"];

            var uaParser = Parser.GetDefault();
            var ua = uaParser.Parse(userAgent);

            var result = (RandomGenerator.NextDouble() * 100) < settings.Percentage;
            return Task.FromResult(result && settings.BrowserFamily.Any(t => ua.UA.Family.Contains(t, StringComparison.OrdinalIgnoreCase)));
        }

        public class BrowserFamilyFilterSettings
        {
            public string[] BrowserFamily { get; set; }

            public short Percentage { get; set; }
        }
    }
}
