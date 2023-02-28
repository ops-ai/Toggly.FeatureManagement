using Finbuckle.MultiTenant;
using Raven.Client.Documents;

namespace Demo.Mvc.Multitenant
{/// <summary>
 /// RavenDB store for multitenant settings
 /// </summary>
    public class RavenDBMultitenantStore : IMultiTenantStore<Application>
    {
        private IDocumentStore _store;

        /// <summary>
        /// 
        /// </summary>
        /// <param name="store"></param>
        /// <param name="memoryCache"></param>
        public RavenDBMultitenantStore(IDocumentStore store)
        {
            _store = store;
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
            using var session = _store.OpenAsyncSession();
            if (await session.Advanced.ExistsAsync($"Applications/{tenantInfo.Id}"))
                return false;

            //TODO: unique constraint on identifier, property validation?
            tenantInfo.Id = $"Applications/{tenantInfo.Id}";

            await session.StoreAsync(tenantInfo);
            await session.SaveChangesAsync();

            return true;
        }

        /// <summary>
        /// Get a tenant by id
        /// </summary>
        /// <param name="id"></param>
        /// <returns></returns>
        public async Task<Application?> TryGetAsync(string id)
        {
            using var session = _store.OpenAsyncSession();
            var tenant = await session.LoadAsync<Application>($"Applications/{id}");
            if (tenant == null)
                return null;

            tenant.Id = tenant.Id!.Split('/').Last();

            return tenant;
        }

        /// <summary>
        /// Find a tenant by identifier
        /// </summary>
        /// <param name="identifier"></param>
        /// <returns></returns>
        public async Task<Application?> TryGetByIdentifierAsync(string identifier)
        {
            using var session = _store.OpenAsyncSession();
            var tenant = await session.Query<Application>().FirstOrDefaultAsync(t => t.Identifier!.Equals(identifier));
            if (tenant == null)
                return null;

            tenant.Id = tenant.Id!.Split('/').Last();

            return tenant;
        }

        /// <summary>
        /// Remove tenant settings
        /// </summary>
        /// <param name="id"></param>
        /// <returns></returns>
        public async Task<bool> TryRemoveAsync(string id)
        {
            using var session = _store.OpenAsyncSession();
            var tenant = await session.LoadAsync<Application>($"Applications/{id}");
            if (tenant != null)
            {
                session.Delete(tenant);
                await session.SaveChangesAsync();

                return true;
            }
            return false;
        }

        /// <summary>
        /// Update tenant
        /// </summary>
        /// <param name="tenantInfo"></param>
        /// <returns></returns>
        public async Task<bool> TryUpdateAsync(Application tenantInfo)
        {
            using var session = _store.OpenAsyncSession();
            await session.StoreAsync(tenantInfo);
            await session.SaveChangesAsync();

            return true;
        }
    }
}
