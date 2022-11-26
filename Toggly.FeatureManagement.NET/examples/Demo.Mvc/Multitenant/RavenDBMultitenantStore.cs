using Finbuckle.MultiTenant;
using Microsoft.Extensions.Caching.Memory;
using Raven.Client.Documents;

namespace Demo.Mvc.Multitenant
{/// <summary>
 /// RavenDB store for multitenant settings
 /// </summary>
    public class RavenDBMultitenantStore : IMultiTenantStore<Application>
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

            _store.Changes().ForDocumentsInCollection<Application>().Subscribe(change =>
            {
                _cache.Remove($"ApplicationId-{change.Id.Split('/').Last()}");
                _cache.Remove($"Application-{change.Id.Split('/').Last()}");
            });
        }

        public async Task<IEnumerable<Application>> GetAllAsync()
        {
            using (var session = _store.OpenAsyncSession())
            {
                var tenants = await session.Query<Application>().ToListAsync();
                tenants.ForEach(t =>
                {
                    t.Id = t.Id!.Split('/').Last();
                });
                return tenants;
            }
        }

        /// <summary>
        /// Add a new tenant
        /// </summary>
        /// <param name="tenantInfo"></param>
        /// <returns></returns>
        public async Task<bool> TryAddAsync(Application tenantInfo)
        {
            using (var session = _store.OpenAsyncSession())
            {
                if (await session.Advanced.ExistsAsync($"Applications/{tenantInfo.Id}"))
                    return false;

                //TODO: unique constraint on identifier, property validation?
                tenantInfo.Id = $"Applications/{tenantInfo.Id}";

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
        public async Task<Application?> TryGetAsync(string id)
        {
            if (!_cache.TryGetValue($"ApplicationId-{id}", out Application cachedTenant))
            {
                using (var session = _store.OpenAsyncSession())
                {
                    cachedTenant = await session.LoadAsync<Application>($"Applications/{id}");
                    if (cachedTenant == null)
                        return null;

                    cachedTenant.Id = cachedTenant.Id!.Split('/').Last();
                }

                _cache.Set($"ApplicationId-{id}", cachedTenant, new MemoryCacheEntryOptions().SetSlidingExpiration(TimeSpan.FromMinutes(1)));
            }
            return cachedTenant;
        }

        /// <summary>
        /// Find a tenant by identifier
        /// </summary>
        /// <param name="identifier"></param>
        /// <returns></returns>
        public async Task<Application?> TryGetByIdentifierAsync(string identifier)
        {
            if (!_cache.TryGetValue($"Application-{identifier}", out Application cachedTenant))
            {
                using (var session = _store.OpenAsyncSession())
                {
                    cachedTenant = await session.Query<Application>().FirstOrDefaultAsync(t => t.Identifier!.Equals(identifier));
                    if (cachedTenant == null)
                        return null;

                    cachedTenant.Id = cachedTenant.Id!.Split('/').Last();
                }

                _cache.Set($"Application-{identifier}", cachedTenant, new MemoryCacheEntryOptions().SetSlidingExpiration(TimeSpan.FromMinutes(1)));
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
                var tenant = await session.LoadAsync<Application>($"Applications/{id}");
                if (tenant != null)
                {
                    session.Delete(tenant);
                    await session.SaveChangesAsync();

                    _cache.Remove($"Application-{tenant.Identifier}");
                    _cache.Remove($"ApplicationId-{tenant.Id!.Split('/').Last()}");

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
        public async Task<bool> TryUpdateAsync(Application tenantInfo)
        {
            using (var session = _store.OpenAsyncSession())
            {
                await session.StoreAsync(tenantInfo);
                await session.SaveChangesAsync();

                _cache.Remove($"Application-{tenantInfo.Identifier}");
                _cache.Remove($"ApplicationId-{tenantInfo.Id!.Split('/').Last()}");

                return true;
            }
        }
    }
}
