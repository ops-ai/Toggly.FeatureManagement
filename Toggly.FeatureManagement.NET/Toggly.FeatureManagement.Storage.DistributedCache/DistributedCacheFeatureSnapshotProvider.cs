using Microsoft.Extensions.Options;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Data;
using Microsoft.Extensions.Caching.Distributed;
using System.Text.Json;
using System;

namespace Toggly.FeatureManagement.Storage.DistributedCache
{
    /// <summary>
    /// Internal DTO for feature snapshot serialization
    /// </summary>
    internal class FeatureSnapshotDto
    {
        public List<FeatureDefinitionModel>? Features { get; set; }
        public string? Signature { get; set; }
        public string? KeyId { get; set; }
        public long? Timestamp { get; set; }
    }

    /// <summary>
    /// Internal DTO for JWK snapshot serialization
    /// </summary>
    internal class JwkSnapshotDto
    {
        public JsonWebKeySet? Jwks { get; set; }
        public long? Timestamp { get; set; }
    }

    /// <summary>
    /// Distributed cache feature snapshot provider
    /// </summary>
    public class DistributedCacheFeatureSnapshotProvider : IFeatureSnapshotProvider
    {
        private readonly IDistributedCache _cache;
        private readonly IOptions<TogglySnapshotSettings> _snapshotSettings;

        /// <summary>
        /// Constructor
        /// </summary>
        /// <param name="cache"></param>
        /// <param name="snapshotSettings"></param>
        public DistributedCacheFeatureSnapshotProvider(IDistributedCache cache, IOptions<TogglySnapshotSettings> snapshotSettings)
        {
            _cache = cache;
            _snapshotSettings = snapshotSettings;
        }

        /// <summary>
        /// Get the snapshot of the features
        /// </summary>
        /// <param name="ct"></param>
        /// <returns></returns>
        public async Task<(List<FeatureDefinitionModel>? Features, string? Signature, string? KeyId, long? Timestamp)> GetFeaturesSnapshotAsync(CancellationToken ct = default)
        {
            var snapshot = await _cache.GetAsync(_snapshotSettings.Value.DocumentName ?? "FeatureSnapshots", ct).ConfigureAwait(false);
            if (snapshot == null)
            {
                return (null, null, null, null);
            }
            var dto = JsonSerializer.Deserialize<FeatureSnapshotDto>(snapshot);
            return (dto?.Features, dto?.Signature, dto?.KeyId, dto?.Timestamp);
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
            var dto = new FeatureSnapshotDto
            {
                Features = features,
                Signature = signature,
                KeyId = keyId,
                Timestamp = timestamp
            };
            await _cache.SetAsync(_snapshotSettings.Value.DocumentName ?? "FeatureSnapshots", JsonSerializer.SerializeToUtf8Bytes(dto), ct).ConfigureAwait(false);
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
            var dto = new JwkSnapshotDto
            {
                Jwks = jwks,
                Timestamp = timestamp
            };
            await _cache.SetAsync(_snapshotSettings.Value.JwkDocumentName ?? "JwkSnapshots", JsonSerializer.SerializeToUtf8Bytes(dto), new DistributedCacheEntryOptions { AbsoluteExpiration = DateTimeOffset.FromUnixTimeSeconds(timestamp) }, ct).ConfigureAwait(false);
        }

        /// <summary>
        /// Get the snapshot of the JWKs
        /// </summary>
        /// <param name="ct"></param>
        /// <returns></returns>
        public async Task<(JsonWebKeySet? Jwks, long? Timestamp)> GetJwkSnapshotAsync(CancellationToken ct = default)
        {
            var snapshot = await _cache.GetAsync(_snapshotSettings.Value.JwkDocumentName ?? "JwkSnapshots", ct).ConfigureAwait(false);
            if (snapshot == null)
            {
                return (null, null);
            }
            var dto = JsonSerializer.Deserialize<JwkSnapshotDto>(snapshot);
            return (dto?.Jwks, dto?.Timestamp);
        }
    }
}