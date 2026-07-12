using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Feature snapshot provider — persists last-known-good definitions and JWKS
    /// for faster cold start and offline resilience.
    /// </summary>
    public interface IFeatureSnapshotProvider
    {
        /// <summary>
        /// Save the snapshot of the features (including raw signed defs when available).
        /// </summary>
        Task SaveSnapshotAsync(FeatureDefinitionsSnapshot snapshot, CancellationToken ct = default);

        /// <summary>
        /// Get the snapshot of the features.
        /// </summary>
        Task<FeatureDefinitionsSnapshot?> GetFeaturesSnapshotAsync(CancellationToken ct = default);

        /// <summary>
        /// Delete the persisted feature definitions snapshot.
        /// </summary>
        Task ClearSnapshotAsync(CancellationToken ct = default);

        /// <summary>
        /// Save the snapshot of the JWKs.
        /// </summary>
        Task SaveJwkSnapshot(JsonWebKeySet jwks, long timestamp, CancellationToken ct = default);

        /// <summary>
        /// Get the snapshot of the JWKs.
        /// </summary>
        Task<(JsonWebKeySet? Jwks, long? Timestamp)> GetJwkSnapshotAsync(CancellationToken ct = default);

        /// <summary>
        /// Delete the persisted JWKS snapshot.
        /// </summary>
        Task ClearJwkSnapshotAsync(CancellationToken ct = default);
    }
}
