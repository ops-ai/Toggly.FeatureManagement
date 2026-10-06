#nullable enable

using Microsoft.AspNetCore.Http;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Context;

namespace Toggly.FeatureManagement.Web
{
    /// <summary>
    /// Supplies request-scoped feature access and context identifiers.
    /// </summary>
    public class HttpFeatureContextProvider : IFeatureContextProvider
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ITogglyEntityContextResolver? _entityResolver;

        /// <summary>
        /// Creates a provider for the active HTTP request.
        /// </summary>
        /// <param name="httpContextAccessor">Provides the current HTTP context.</param>
        /// <param name="entityResolver">Optionally resolves entity context identifiers.</param>
        public HttpFeatureContextProvider(
            IHttpContextAccessor httpContextAccessor,
            ITogglyEntityContextResolver? entityResolver = null)
        {
            _httpContextAccessor = httpContextAccessor;
            _entityResolver = entityResolver;
        }

        /// <summary>
        /// Reports whether a feature was already accessed during the active request.
        /// </summary>
        /// <param name="featureName">The evaluated feature name.</param>
        /// <returns><c>true</c> when the feature was already accessed.</returns>
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

        /// <summary>
        /// Reports whether a feature and entity context were already accessed in the request.
        /// </summary>
        /// <typeparam name="TContext">The entity context type.</typeparam>
        /// <param name="featureName">The evaluated feature name.</param>
        /// <param name="context">The entity context.</param>
        /// <returns><c>true</c> when the feature context was already accessed.</returns>
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
        
        /// <summary>
        /// Gets an identifier for the current request user.
        /// </summary>
        /// <returns>The user name, remote address, or an empty string.</returns>
        public Task<string> GetContextIdentifierAsync()
        {
            return Task.FromResult(GetUserIdentifier());
        }
     
        /// <summary>
        /// Gets an identifier for the current request user and optional entity context.
        /// </summary>
        /// <typeparam name="TContext">The entity context type.</typeparam>
        /// <param name="context">The entity context.</param>
        /// <returns>The request identifier, optionally scoped to the resolved entity.</returns>
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
