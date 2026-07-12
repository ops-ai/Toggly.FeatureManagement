using Microsoft.Extensions.Options;
using Raven.Client.Documents;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Storage.RavenDB
{
    /// <summary>
    /// RavenDB feature snapshot provider
    /// </summary>
    public class RavenDBFeatureSnapshotProvider : IFeatureSnapshotProvider
    {
        private readonly IDocumentStore _store;
        private readonly IOptions<TogglySnapshotSettings> _snapshotSettings;

        /// <summary>
        /// Constructor
        /// </summary>
        /// <param name="store"></param>
        /// <param name="snapshotSettings"></param>
        public RavenDBFeatureSnapshotProvider(IDocumentStore store, IOptions<TogglySnapshotSettings> snapshotSettings)
        {
            _store = store;
            _snapshotSettings = snapshotSettings;
        }

        private string FeatureDocumentName => _snapshotSettings.Value.DocumentName ?? "FeatureSnapshots/Toggly";

        private string JwkDocumentName => _snapshotSettings.Value.JwkDocumentName ?? "JwkSnapshots/Toggly";

        /// <summary>
        /// Get the snapshot of the features
        /// </summary>
        /// <param name="ct"></param>
        /// <returns></returns>
        public async Task<FeatureDefinitionsSnapshot?> GetFeaturesSnapshotAsync(CancellationToken ct = default)
        {
            try
            {
                using (var session = _store.OpenAsyncSession())
                {
                    var snapshot = await session.LoadAsync<FeatureSnapshot>(FeatureDocumentName, ct).ConfigureAwait(false);
                    if (snapshot == null)
                    {
                        return null;
                    }

                    return new FeatureDefinitionsSnapshot
                    {
                        Features = snapshot.Features,
                        Signature = snapshot.Signature,
                        KeyId = snapshot.KeyId,
                        Timestamp = snapshot.Timestamp,
                        SignedDefsJson = snapshot.SignedDefsJson,
                        ETag = snapshot.ETag
                    };
                }
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Save the snapshot of the features
        /// </summary>
        /// <param name="snapshot"></param>
        /// <param name="ct"></param>
        /// <returns></returns>
        public async Task SaveSnapshotAsync(FeatureDefinitionsSnapshot snapshot, CancellationToken ct = default)
        {
            using (var session = _store.OpenAsyncSession())
            {
                var existing = await session.LoadAsync<FeatureSnapshot>(FeatureDocumentName, ct).ConfigureAwait(false);
                if (existing == null)
                {
                    existing = new FeatureSnapshot
                    {
                        Id = FeatureDocumentName,
                        Features = snapshot.Features,
                        Signature = snapshot.Signature,
                        KeyId = snapshot.KeyId,
                        Timestamp = snapshot.Timestamp,
                        SignedDefsJson = snapshot.SignedDefsJson,
                        ETag = snapshot.ETag
                    };
                    await session.StoreAsync(existing, ct).ConfigureAwait(false);
                    await session.SaveChangesAsync(ct).ConfigureAwait(false);
                }
                else
                {
                    existing.Features = snapshot.Features;
                    existing.Signature = snapshot.Signature;
                    existing.KeyId = snapshot.KeyId;
                    existing.Timestamp = snapshot.Timestamp;
                    existing.SignedDefsJson = snapshot.SignedDefsJson;
                    existing.ETag = snapshot.ETag;
                    await session.SaveChangesAsync(ct).ConfigureAwait(false);
                }
            }
        }

        /// <summary>
        /// Delete the persisted feature definitions snapshot.
        /// </summary>
        /// <param name="ct"></param>
        public async Task ClearSnapshotAsync(CancellationToken ct = default)
        {
            using (var session = _store.OpenAsyncSession())
            {
                session.Delete(FeatureDocumentName);
                await session.SaveChangesAsync(ct).ConfigureAwait(false);
            }
        }

        /// <summary>
        /// Save the snapshot of the JWKs
        /// </summary>
        /// <param name="jwks"></param>
        /// <param name="timestamp"></param>
        /// <param name="ct"></param>
        /// <returns></returns>
        public async Task SaveJwkSnapshot(JsonWebKeySet jwks, long timestamp, CancellationToken ct = default)
        {
            using (var session = _store.OpenAsyncSession())
            {
                var snapshot = await session.LoadAsync<JwkSnapshot>(JwkDocumentName, ct).ConfigureAwait(false);
                if (snapshot == null)
                {
                    snapshot = new JwkSnapshot { Id = JwkDocumentName, Jwks = jwks, Timestamp = timestamp };
                    await session.StoreAsync(snapshot, ct).ConfigureAwait(false);
                    await session.SaveChangesAsync(ct).ConfigureAwait(false);
                }
            }
        }

        /// <summary>
        /// Get the snapshot of the JWKs
        /// </summary>
        /// <param name="ct"></param>
        /// <returns></returns>
        public async Task<(JsonWebKeySet? Jwks, long? Timestamp)> GetJwkSnapshotAsync(CancellationToken ct = default)
        {
            using (var session = _store.OpenAsyncSession())
            {
                var snapshot = await session.LoadAsync<JwkSnapshot>(JwkDocumentName, ct).ConfigureAwait(false);
                return (snapshot?.Jwks, snapshot?.Timestamp);
            }
        }

        /// <summary>
        /// Delete the persisted JWKS snapshot.
        /// </summary>
        /// <param name="ct"></param>
        public async Task ClearJwkSnapshotAsync(CancellationToken ct = default)
        {
            using (var session = _store.OpenAsyncSession())
            {
                session.Delete(JwkDocumentName);
                await session.SaveChangesAsync(ct).ConfigureAwait(false);
            }
        }
    }
}
