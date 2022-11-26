using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.Web.Filters
{
    [FilterAlias("CountryFamily")]
    public class CountryFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;

        public CountryFilter(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
        }

        public Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
            var settings = context.Parameters.Get<CountryFilterSettings>() ?? new CountryFilterSettings();

            var ipCountry = _httpContextAccessor.HttpContext.Request.Headers["CF-IPCountry"];

            var result = (RandomGenerator.NextDouble() * 100) < settings.Percentage;
            return Task.FromResult(result && settings.Country.Any(t => t.Equals(ipCountry, StringComparison.OrdinalIgnoreCase)));
        }

        public class CountryFilterSettings
        {
            public string[] Country { get; set; }

            public short Percentage { get; set; }
        }
    }
}
