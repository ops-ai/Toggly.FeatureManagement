using Raven.Client.Documents;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Storage.RavenDB
{
    public class RavenDBFeatureSnapshotProvider : IFeatureSnapshotProvider
    {
        private readonly IDocumentStore _store;

        public RavenDBFeatureSnapshotProvider(IDocumentStore store)
        {
            _store = store;
        }

        public async Task<List<FeatureDefinitionModel>?> GetFeaturesSnapshotAsync(CancellationToken ct = default)
        {
            using (var session = _store.OpenAsyncSession())
            {
                var snapshot = await session.LoadAsync<FeatureSnapshot>("FeatureSnapshots/Toggly", ct);
                return snapshot?.Features;
            }
        }
        
        public async Task SaveSnapshotAsync(List<FeatureDefinitionModel> features, CancellationToken ct = default)
        {
            using (var session = _store.OpenAsyncSession())
            {
                var snapshot = new FeatureSnapshot { Id = "FeatureSnapshots/Toggly", Features = features };
                await session.StoreAsync(snapshot, ct);
                await session.SaveChangesAsync(ct);
            }
        }
    }
}