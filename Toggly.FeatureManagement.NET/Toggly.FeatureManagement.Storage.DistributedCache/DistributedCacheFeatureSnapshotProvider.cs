using Microsoft.Extensions.Options;
using System.Collections.Generic;
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
        public string? SignedDefsJson { get; set; }
        public string? ETag { get; set; }
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

        private string FeatureDocumentName => _snapshotSettings.Value.DocumentName ?? "FeatureSnapshots";

        private string JwkDocumentName => _snapshotSettings.Value.JwkDocumentName ?? "JwkSnapshots";

        /// <summary>
        /// Get the snapshot of the features
        /// </summary>
        /// <param name="ct"></param>
        /// <returns></returns>
        public async Task<FeatureDefinitionsSnapshot?> GetFeaturesSnapshotAsync(CancellationToken ct = default)
        {
            var snapshot = await _cache.GetAsync(FeatureDocumentName, ct).ConfigureAwait(false);
            if (snapshot == null)
            {
                return null;
            }

            var dto = JsonSerializer.Deserialize<FeatureSnapshotDto>(snapshot);
            if (dto == null)
            {
                return null;
            }

            return new FeatureDefinitionsSnapshot
            {
                Features = dto.Features,
                Signature = dto.Signature,
                KeyId = dto.KeyId,
                Timestamp = dto.Timestamp,
                SignedDefsJson = dto.SignedDefsJson,
                ETag = dto.ETag
            };
        }

        /// <summary>
        /// Save the snapshot of the features
        /// </summary>
        /// <param name="snapshot"></param>
        /// <param name="ct"></param>
        /// <returns></returns>
        public async Task SaveSnapshotAsync(FeatureDefinitionsSnapshot snapshot, CancellationToken ct = default)
        {
            var dto = new FeatureSnapshotDto
            {
                Features = snapshot.Features,
                Signature = snapshot.Signature,
                KeyId = snapshot.KeyId,
                Timestamp = snapshot.Timestamp,
                SignedDefsJson = snapshot.SignedDefsJson,
                ETag = snapshot.ETag
            };
            await _cache.SetAsync(FeatureDocumentName, JsonSerializer.SerializeToUtf8Bytes(dto), ct).ConfigureAwait(false);
        }

        /// <summary>
        /// Delete the persisted feature definitions snapshot.
        /// </summary>
        /// <param name="ct"></param>
        public Task ClearSnapshotAsync(CancellationToken ct = default)
        {
            return _cache.RemoveAsync(FeatureDocumentName, ct);
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
            await _cache.SetAsync(JwkDocumentName, JsonSerializer.SerializeToUtf8Bytes(dto), new DistributedCacheEntryOptions { AbsoluteExpiration = DateTimeOffset.FromUnixTimeSeconds(timestamp) }, ct).ConfigureAwait(false);
        }

        /// <summary>
        /// Get the snapshot of the JWKs
        /// </summary>
        /// <param name="ct"></param>
        /// <returns></returns>
        public async Task<(JsonWebKeySet? Jwks, long? Timestamp)> GetJwkSnapshotAsync(CancellationToken ct = default)
        {
            var snapshot = await _cache.GetAsync(JwkDocumentName, ct).ConfigureAwait(false);
            if (snapshot == null)
            {
                return (null, null);
            }
            var dto = JsonSerializer.Deserialize<JwkSnapshotDto>(snapshot);
            return (dto?.Jwks, dto?.Timestamp);
        }

        /// <summary>
        /// Delete the persisted JWKS snapshot.
        /// </summary>
        /// <param name="ct"></param>
        public Task ClearJwkSnapshotAsync(CancellationToken ct = default)
        {
            return _cache.RemoveAsync(JwkDocumentName, ct);
        }
    }
}
