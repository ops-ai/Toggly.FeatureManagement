using Finbuckle.MultiTenant;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.FeatureManagement;
using Raven.Client.Documents;
using Toggly.FeatureManagement;

namespace Demo.Mvc.Multitenant
{
    public class MultitenantFeatureDefinitionProvider : IFeatureDefinitionProvider, IFeatureExperimentProvider
    {
        private readonly IDocumentStore _store;
        private readonly IMemoryCache _cache;
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ILogger _logger;

        public MultitenantFeatureDefinitionProvider(ILoggerFactory loggerFactory, IDocumentStore store, IMemoryCache memoryCache, IHttpContextAccessor httpContextAccessor)
        {
            _store = store;
            _cache = memoryCache;
            _httpContextAccessor = httpContextAccessor;
            _logger = loggerFactory.CreateLogger<MultitenantFeatureDefinitionProvider>();

            _store.Changes().ForDocumentsInCollection<Application>().Subscribe(change =>
            {
                _cache.Remove($"AppId-{change.Id.Split('/').Last()}");
            });
        }

        private async Task<Dictionary<string, FeatureDefinition>> GetFeatures()
        {
            var tenantId = _httpContextAccessor.HttpContext?.GetMultiTenantContext<Application>()?.TenantInfo?.Identifier;
            if (tenantId == null)
                return new Dictionary<string, FeatureDefinition>();

            if (!_cache.TryGetValue($"AppId-{tenantId}", out Dictionary<string, FeatureDefinition> cachedFeatures))
            {
                using (var session = _store.OpenAsyncSession())
                {
                    var app = await session.LoadAsync<Application>($"Applications/{tenantId}");
                    cachedFeatures = app.Definitions.ToDictionary(t => t.Key, t => new FeatureDefinition
                    {
                        Name = t.Key,
                        EnabledFor = t.Value.Select(featureFilter =>
                            new FeatureFilterConfiguration
                            {
                                Name = featureFilter.Name,
                                Parameters = new ConfigurationBuilder().AddInMemoryCollection(featureFilter.Parameters).Build()
                            })
                    });
                }

                _cache.Set($"AppId-{tenantId}", cachedFeatures, new MemoryCacheEntryOptions().SetSlidingExpiration(TimeSpan.FromMinutes(5)));
            }
            return cachedFeatures;
        }

        public async IAsyncEnumerable<FeatureDefinition> GetAllFeatureDefinitionsAsync()
        {
            var definitions = await GetFeatures();

            foreach (var feature in definitions.Values)
                yield return feature;
        }

        public async Task<FeatureDefinition> GetFeatureDefinitionAsync(string featureName)
        {
            var definitions = await GetFeatures();

            if (definitions.TryGetValue(featureName, out var updatedFeature))
                return updatedFeature;

            return new FeatureDefinition { Name = featureName, EnabledFor = new List<FeatureFilterConfiguration>() };
        }

        public List<string>? GetFeaturesForMetric(string metricKey)
        {
            return new List<string>();
        }
    }
}
