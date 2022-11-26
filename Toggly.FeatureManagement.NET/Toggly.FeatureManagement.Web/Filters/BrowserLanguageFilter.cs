using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using System;
using System.Linq;
using System.Threading.Tasks;
using UAParser;

namespace Toggly.FeatureManagement.Web.Filters
{
    [FilterAlias("BrowserLanguage")]
    public class BrowserLanguageFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;

        public BrowserLanguageFilter(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
        }

        public Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
            var settings = context.Parameters.Get<BrowserLanguageFilterSettings>() ?? new BrowserLanguageFilterSettings();

            var acceptLanguage = _httpContextAccessor.HttpContext.Request.Headers["Accept-Language"].FirstOrDefault();

            var result = (RandomGenerator.NextDouble() * 100) < settings.Percentage;
            return Task.FromResult(result && settings.BrowserLanguage.Any(t => acceptLanguage?.Contains(t, StringComparison.OrdinalIgnoreCase) ?? false));
        }

        public class BrowserLanguageFilterSettings
        {
            public string[] BrowserLanguage { get; set; }

            public short Percentage { get; set; }
        }
    }
}
