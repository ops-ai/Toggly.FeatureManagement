using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Feature snapshot provider
    /// </summary>
    public interface IFeatureSnapshotProvider
    {
        /// <summary>
        /// Save the snapshot of the features
        /// </summary>
        /// <param name="features"></param>
        /// <param name="signature"></param>
        /// <param name="keyId"></param>
        /// <param name="timestamp"></param>
        /// <param name="ct"></param>
        /// <returns></returns>
        Task SaveSnapshotAsync(List<FeatureDefinitionModel> features, string? signature = null, string? keyId = null, long? timestamp = null, CancellationToken ct = default);


        /// <summary>
        /// Get the snapshot of the features
        /// </summary>
        /// <param name="ct"></param>
        /// <returns></returns>
        Task<(List<FeatureDefinitionModel>? Features, string? Signature, string? KeyId, long? Timestamp)> GetFeaturesSnapshotAsync(CancellationToken ct = default);

        /// <summary>
        /// Save the snapshot of the JWKs
        /// </summary>
        /// <param name="jwks"></param>
        /// <param name="timestamp"></param>
        /// <param name="ct"></param>
        /// <returns></returns>
        Task SaveJwkSnapshot(JsonWebKeySet jwks, long timestamp, CancellationToken ct = default);

        /// <summary>
        /// Get the snapshot of the JWKs
        /// </summary>
        /// <param name="ct"></param>
        /// <returns></returns>
        Task<(JsonWebKeySet? Jwks, long? Timestamp)> GetJwkSnapshotAsync(CancellationToken ct = default);
    }
}
