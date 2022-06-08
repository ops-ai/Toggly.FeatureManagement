using Finbuckle.MultiTenant;
using Microsoft.Extensions.Caching.Memory;
using Raven.Client.Documents;

namespace Demo.Mvc.Multitenant
{/// <summary>
 /// RavenDB store for multitenant settings
 /// </summary>
    public class RavenDBMultitenantStore : IMultiTenantStore<DemoApplication>
    {
        private IDocumentStore _store;
        private IMemoryCache _cache;

        /// <summary>
        /// 
        /// </summary>
        /// <param name="store"></param>
        /// <param name="memoryCache"></param>
        public RavenDBMultitenantStore(IDocumentStore store, IMemoryCache memoryCache)
        {
            _store = store;
            _cache = memoryCache;

            _store.Changes().ForDocumentsInCollection<DemoApplication>().Subscribe(change =>
            {
                _cache.Remove($"DemoApplicationId-{change.Id.Split('/').Last()}");
                _cache.Remove($"DemoApplication-{change.Id.Split('/').Last()}");
            });
        }

        public async Task<IEnumerable<DemoApplication>> GetAllAsync()
        {
            using (var session = _store.OpenAsyncSession())
            {
                var tenants = await session.Query<DemoApplication>().ToListAsync();
                tenants.ForEach(t =>
                {
                    t.Id = t.Id.Split('/').Last();
                });
                return tenants;
            }
        }

        /// <summary>
        /// Add a new tenant
        /// </summary>
        /// <param name="tenantInfo"></param>
        /// <returns></returns>
        public async Task<bool> TryAddAsync(DemoApplication tenantInfo)
        {
            using (var session = _store.OpenAsyncSession())
            {
                if (await session.Advanced.ExistsAsync($"DemoApplications/{tenantInfo.Id}"))
                    return false;

                //TODO: unique constraint on identifier, property validation?
                tenantInfo.Id = $"DemoApplications/{tenantInfo.Id}";

                await session.StoreAsync(tenantInfo);
                await session.SaveChangesAsync();

                return true;
            }
        }

        /// <summary>
        /// Get a tenant by id
        /// </summary>
        /// <param name="id"></param>
        /// <returns></returns>
        public async Task<DemoApplication?> TryGetAsync(string id)
        {
            if (!_cache.TryGetValue($"DemoApplicationId-{id}", out DemoApplication cachedTenant))
            {
                using (var session = _store.OpenAsyncSession())
                {
                    cachedTenant = await session.LoadAsync<DemoApplication>($"DemoApplications/{id}");
                    cachedTenant.Id = cachedTenant.Id.Split('/').Last();
                }

                _cache.Set($"DemoApplicationId-{id}", cachedTenant, new MemoryCacheEntryOptions().SetSlidingExpiration(TimeSpan.FromMinutes(1)));
            }
            return cachedTenant;
        }

        /// <summary>
        /// Find a tenant by identifier
        /// </summary>
        /// <param name="identifier"></param>
        /// <returns></returns>
        public async Task<DemoApplication?> TryGetByIdentifierAsync(string identifier)
        {
            if (!_cache.TryGetValue($"DemoApplication-{identifier}", out DemoApplication cachedTenant))
            {
                using (var session = _store.OpenAsyncSession())
                {
                    cachedTenant = await session.Query<DemoApplication>().FirstOrDefaultAsync(t => t.Identifier.Equals(identifier));
                    if (cachedTenant == null)
                        return null;

                    cachedTenant.Id = cachedTenant.Id.Split('/').Last();
                }

                _cache.Set($"DemoApplication-{identifier}", cachedTenant, new MemoryCacheEntryOptions().SetSlidingExpiration(TimeSpan.FromMinutes(1)));
            }
            return cachedTenant;
        }

        /// <summary>
        /// Remove tenant settings
        /// </summary>
        /// <param name="id"></param>
        /// <returns></returns>
        public async Task<bool> TryRemoveAsync(string id)
        {
            using (var session = _store.OpenAsyncSession())
            {
                var tenant = await session.LoadAsync<DemoApplication>($"DemoApplications/{id}");
                if (tenant != null)
                {
                    session.Delete(tenant);
                    await session.SaveChangesAsync();

                    _cache.Remove($"DemoApplication-{tenant.Identifier}");
                    _cache.Remove($"DemoApplicationId-{tenant.Id.Split('/').Last()}");

                    return true;
                }
                return false;
            }
        }

        /// <summary>
        /// Update tenant
        /// </summary>
        /// <param name="tenantInfo"></param>
        /// <returns></returns>
        public async Task<bool> TryUpdateAsync(DemoApplication tenantInfo)
        {
            using (var session = _store.OpenAsyncSession())
            {
                await session.StoreAsync(tenantInfo);
                await session.SaveChangesAsync();

                _cache.Remove($"DemoApplication-{tenantInfo.Identifier}");
                _cache.Remove($"DemoApplicationId-{tenantInfo.Id.Split('/').Last()}");

                return true;
            }
        }
    }
}
