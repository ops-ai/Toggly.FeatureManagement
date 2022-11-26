using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.Web.Filters
{
    [FilterAlias("UserClaims")]
    public class UserClaimsFilter : IFeatureFilter
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        
        public UserClaimsFilter(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
        }

        public async Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context)
        {
            UserClaimsFilterSettings settings = context.Parameters.Get<UserClaimsFilterSettings>() ?? new UserClaimsFilterSettings();

            var result = (RandomGenerator.NextDouble() * 100) < settings.Percentage;
            return result && (_httpContextAccessor.HttpContext?.User?.HasClaim(settings.Claim, settings.Value) ?? false);
        }
    }

    public class UserClaimsFilterSettings
    {
        public string Claim { get; set; }

        public string Value { get; set; }

        public short Percentage { get; set; }
    }
}
