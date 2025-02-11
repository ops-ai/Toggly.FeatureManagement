using Microsoft.Extensions.Options;
using Raven.Client.Documents;
using System.Collections.Generic;
using System.Linq;
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

        /// <summary>
        /// Get the snapshot of the features
        /// </summary>
        /// <param name="ct"></param>
        /// <returns></returns>
        public async Task<(List<FeatureDefinitionModel>? Features, string? Signature, string? KeyId, long? Timestamp)> GetFeaturesSnapshotAsync(CancellationToken ct = default)
        {
            try
            {
                using (var session = _store.OpenAsyncSession())
                {
                    var snapshot = await session.LoadAsync<FeatureSnapshot>(_snapshotSettings.Value.DocumentName ?? "FeatureSnapshots/Toggly", ct).ConfigureAwait(false);
                    return (snapshot?.Features, snapshot?.Signature, snapshot?.KeyId, snapshot?.Timestamp);
                }
            }
            catch
            {
                return (null, null, null, null);
            }
        }
        
        /// <summary>
        /// Save the snapshot of the features
        /// </summary>
        /// <param name="features"></param>
        /// <param name="signature"></param>
        /// <param name="keyId"></param>
        /// <param name="timestamp"></param>
        /// <param name="ct"></param>
        /// <returns></returns>
        public async Task SaveSnapshotAsync(List<FeatureDefinitionModel> features, string? signature = null, string? keyId = null, long? timestamp = null, CancellationToken ct = default)
        {
            using (var session = _store.OpenAsyncSession())
            {
                var snapshot = await session.LoadAsync<FeatureSnapshot>(_snapshotSettings.Value.DocumentName ?? "FeatureSnapshots/Toggly", ct).ConfigureAwait(false);
                if (snapshot == null)
                {
                    snapshot = new FeatureSnapshot { Id = _snapshotSettings.Value.DocumentName ?? "FeatureSnapshots/Toggly", Features = features, Signature = signature, KeyId = keyId, Timestamp = timestamp };
                    await session.StoreAsync(snapshot, ct).ConfigureAwait(false);
                    await session.SaveChangesAsync(ct).ConfigureAwait(false);
                }
                else
                {
                    snapshot.Features = features;
                    snapshot.Signature = signature;
                    snapshot.KeyId = keyId;
                    snapshot.Timestamp = timestamp;
                    await session.SaveChangesAsync(ct).ConfigureAwait(false);
                }
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
                var snapshot = await session.LoadAsync<JwkSnapshot>(_snapshotSettings.Value.JwkDocumentName ?? "JwkSnapshots/Toggly", ct).ConfigureAwait(false);
                if (snapshot == null)
                {
                    snapshot = new JwkSnapshot { Id = _snapshotSettings.Value.JwkDocumentName ?? "JwkSnapshots/Toggly", Jwks = jwks, Timestamp = timestamp };
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
                var snapshot = await session.LoadAsync<JwkSnapshot>(_snapshotSettings.Value.JwkDocumentName ?? "JwkSnapshots/Toggly", ct).ConfigureAwait(false);
                return (snapshot?.Jwks, snapshot?.Timestamp);
            }
        }
    }
}