using Microsoft.AspNetCore.Http;

namespace Toggly.FeatureManagement.Web
{
    public class HttpFeatureContextProvider : IFeatureContextProvider
    {
        private readonly IHttpContextAccessor _httpContextAccessor;

        public HttpFeatureContextProvider(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
        }

        public Task<bool> AccessedInRequestAsync(string featureName)
        {
            if (_httpContextAccessor.HttpContext == null)
                return Task.FromResult(true);

            if (_httpContextAccessor.HttpContext.Items.ContainsKey($"feature-{featureName}"))
                return Task.FromResult(true);
            else
                _httpContextAccessor.HttpContext.Items.Add($"feature-{featureName}", true);
            return Task.FromResult(false);
        }

        public Task<bool> AccessedInRequestAsync<TContext>(string featureName, TContext context)
        {
            if (_httpContextAccessor.HttpContext == null)
                return Task.FromResult(true);

            if (_httpContextAccessor.HttpContext.Items.ContainsKey($"feature-{featureName}"))
                return Task.FromResult(true);
            else
                _httpContextAccessor.HttpContext.Items.Add($"feature-{featureName}", true);
            return Task.FromResult(false);
        }
        
        public Task<string> GetContextIdentifierAsync()
        {
            if (_httpContextAccessor.HttpContext == null)
                return Task.FromResult("");

            if (_httpContextAccessor.HttpContext.User != null && _httpContextAccessor.HttpContext.User.Identity?.Name != null)
                return Task.FromResult(_httpContextAccessor.HttpContext.User.Identity.Name!);

            return Task.FromResult(_httpContextAccessor.HttpContext.Connection.RemoteIpAddress.ToString());
        }
     
        public Task<string> GetContextIdentifierAsync<TContext>(TContext context)
        {
            if (_httpContextAccessor.HttpContext == null)
                return Task.FromResult("");

            if (_httpContextAccessor.HttpContext.User != null && _httpContextAccessor.HttpContext.User.Identity?.Name != null)
                return Task.FromResult(_httpContextAccessor.HttpContext.User.Identity.Name!);

            return Task.FromResult(_httpContextAccessor.HttpContext.Connection.RemoteIpAddress.ToString());
        }
    }
}