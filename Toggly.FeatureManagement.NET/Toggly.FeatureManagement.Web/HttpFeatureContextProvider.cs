#nullable enable

using Microsoft.AspNetCore.Http;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Context;

namespace Toggly.FeatureManagement.Web
{
    public class HttpFeatureContextProvider : IFeatureContextProvider
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ITogglyEntityContextResolver? _entityResolver;

        public HttpFeatureContextProvider(
            IHttpContextAccessor httpContextAccessor,
            ITogglyEntityContextResolver? entityResolver = null)
        {
            _httpContextAccessor = httpContextAccessor;
            _entityResolver = entityResolver;
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

            var itemKey = BuildRequestItemKey(featureName, context);
            if (_httpContextAccessor.HttpContext.Items.ContainsKey(itemKey))
                return Task.FromResult(true);

            _httpContextAccessor.HttpContext.Items.Add(itemKey, true);
            return Task.FromResult(false);
        }
        
        public Task<string> GetContextIdentifierAsync()
        {
            return Task.FromResult(GetUserIdentifier());
        }
     
        public Task<string> GetContextIdentifierAsync<TContext>(TContext context)
        {
            var userIdentifier = GetUserIdentifier();
            if (_entityResolver != null && _entityResolver.TryResolve(context, out var entity) && entity != null)
                return Task.FromResult($"{userIdentifier}|{entity.Kind}|{entity.Key}");

            return Task.FromResult(userIdentifier);
        }

        private string GetUserIdentifier()
        {
            if (_httpContextAccessor.HttpContext == null)
                return string.Empty;

            if (_httpContextAccessor.HttpContext.User?.Identity?.Name != null)
                return _httpContextAccessor.HttpContext.User.Identity.Name!;

            return _httpContextAccessor.HttpContext.Connection.RemoteIpAddress?.ToString() ?? string.Empty;
        }

        private string BuildRequestItemKey<TContext>(string featureName, TContext context)
        {
            if (_entityResolver != null && _entityResolver.TryResolve(context, out var entity) && entity != null)
                return $"feature-{featureName}|{entity.Kind}|{entity.Key}";

            return $"feature-{featureName}";
        }
    }
}
