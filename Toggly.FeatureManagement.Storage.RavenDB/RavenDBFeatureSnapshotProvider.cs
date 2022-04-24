using Microsoft.Extensions.Options;
using Raven.Client.Documents;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Storage.RavenDB
{
    public class RavenDBFeatureSnapshotProvider : IFeatureSnapshotProvider
    {
        private readonly IDocumentStore _store;
        private readonly IOptions<TogglySnapshotSettings> _snapshotSettings;

        public RavenDBFeatureSnapshotProvider(IDocumentStore store, IOptions<TogglySnapshotSettings> snapshotSettings)
        {
            _store = store;
            _snapshotSettings = snapshotSettings;
        }

        public async Task<List<FeatureDefinitionModel>?> GetFeaturesSnapshotAsync(CancellationToken ct = default)
        {
            using (var session = _store.OpenAsyncSession())
            {
                var snapshot = await session.LoadAsync<FeatureSnapshot>(_snapshotSettings.Value.DocumentName ?? "FeatureSnapshots/Toggly", ct).ConfigureAwait(false);
                return snapshot?.Features;
            }
        }
        
        public async Task SaveSnapshotAsync(List<FeatureDefinitionModel> features, CancellationToken ct = default)
        {
            using (var session = _store.OpenAsyncSession())
            {
                var snapshot = await session.LoadAsync<FeatureSnapshot>(_snapshotSettings.Value.DocumentName ?? "FeatureSnapshots/Toggly", ct).ConfigureAwait(false);
                if (snapshot == null)
                {
                    snapshot = new FeatureSnapshot { Id = _snapshotSettings.Value.DocumentName ?? "FeatureSnapshots/Toggly", Features = features };
                    await session.StoreAsync(snapshot, ct).ConfigureAwait(false);
                    await session.SaveChangesAsync(ct).ConfigureAwait(false);
                }
                else if (snapshot.Features.Count != features.Count || !snapshot.Features.SequenceEqual(features))
                {
                    snapshot.Features = features;
                    await session.SaveChangesAsync(ct).ConfigureAwait(false);
                }
            }
        }
    }
}