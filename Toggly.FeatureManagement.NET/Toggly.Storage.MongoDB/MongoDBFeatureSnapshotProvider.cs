using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Driver;
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Storage.MongoDB
{
    /// <summary>
    /// MongoDB feature snapshot provider
    /// </summary>
    public class MongoDBFeatureSnapshotProvider : IFeatureSnapshotProvider
    {
        private readonly IMongoClient _client;
        private readonly IOptions<TogglySnapshotSettings> _snapshotSettings;
        private IMongoCollection<SnapshotDocument>? _collection;

        /// <summary>
        /// Constructor
        /// </summary>
        /// <param name="client">MongoDB client</param>
        /// <param name="snapshotSettings">Snapshot settings</param>
        public MongoDBFeatureSnapshotProvider(
            IMongoClient client,
            IOptions<TogglySnapshotSettings> snapshotSettings)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _snapshotSettings = snapshotSettings;
        }

        private IMongoCollection<SnapshotDocument> GetCollection()
        {
            if (_collection == null)
            {
                var database = _client.GetDatabase(_snapshotSettings.Value.DatabaseName);
                _collection = database.GetCollection<SnapshotDocument>(_snapshotSettings.Value.CollectionName);
            }
            return _collection;
        }

        /// <summary>
        /// Get the snapshot of the features
        /// </summary>
        /// <param name="ct">Cancellation token</param>
        /// <returns>Feature snapshot with signature metadata</returns>
        public async Task<(List<FeatureDefinitionModel>? Features, string? Signature, string? KeyId, long? Timestamp)> GetFeaturesSnapshotAsync(CancellationToken ct = default)
        {
            try
            {
                var collection = GetCollection();
                var documentName = _snapshotSettings.Value.DocumentName;

                var snapshot = await collection
                    .Find(d => d.Id == documentName)
                    .FirstOrDefaultAsync(ct)
                    .ConfigureAwait(false);

                if (snapshot == null || string.IsNullOrEmpty(snapshot.Data))
                {
                    return (null, null, null, null);
                }

                var features = JsonSerializer.Deserialize<List<FeatureDefinitionModel>>(snapshot.Data);
                return (features, snapshot.Signature, snapshot.KeyId, snapshot.Timestamp);
            }
            catch
            {
                return (null, null, null, null);
            }
        }

        /// <summary>
        /// Save the snapshot of the features
        /// </summary>
        /// <param name="features">Feature definitions</param>
        /// <param name="signature">Signature for signed definitions</param>
        /// <param name="keyId">Key ID for signature verification</param>
        /// <param name="timestamp">Timestamp of the definitions</param>
        /// <param name="ct">Cancellation token</param>
        public async Task SaveSnapshotAsync(List<FeatureDefinitionModel> features, string? signature = null, string? keyId = null, long? timestamp = null, CancellationToken ct = default)
        {
            var collection = GetCollection();
            var documentName = _snapshotSettings.Value.DocumentName;
            var jsonData = JsonSerializer.Serialize(features);

            var document = new SnapshotDocument
            {
                Id = documentName,
                Data = jsonData,
                Signature = signature,
                KeyId = keyId,
                Timestamp = timestamp,
                UpdatedAt = DateTime.UtcNow
            };

            await collection.ReplaceOneAsync(
                d => d.Id == documentName,
                document,
                new ReplaceOptions { IsUpsert = true },
                ct
            ).ConfigureAwait(false);
        }

        /// <summary>
        /// Save the snapshot of the JWKs
        /// </summary>
        /// <param name="jwks">JSON Web Key Set</param>
        /// <param name="timestamp">Timestamp of the JWKs</param>
        /// <param name="ct">Cancellation token</param>
        public async Task SaveJwkSnapshot(JsonWebKeySet jwks, long timestamp, CancellationToken ct = default)
        {
            var collection = GetCollection();
            var documentName = _snapshotSettings.Value.JwkDocumentName;
            var jsonData = JsonSerializer.Serialize(jwks);

            var document = new SnapshotDocument
            {
                Id = documentName,
                Data = jsonData,
                Signature = null,
                KeyId = null,
                Timestamp = timestamp,
                UpdatedAt = DateTime.UtcNow
            };

            await collection.ReplaceOneAsync(
                d => d.Id == documentName,
                document,
                new ReplaceOptions { IsUpsert = true },
                ct
            ).ConfigureAwait(false);
        }

        /// <summary>
        /// Get the snapshot of the JWKs
        /// </summary>
        /// <param name="ct">Cancellation token</param>
        /// <returns>JWK snapshot with timestamp</returns>
        public async Task<(JsonWebKeySet? Jwks, long? Timestamp)> GetJwkSnapshotAsync(CancellationToken ct = default)
        {
            try
            {
                var collection = GetCollection();
                var documentName = _snapshotSettings.Value.JwkDocumentName;

                var snapshot = await collection
                    .Find(d => d.Id == documentName)
                    .FirstOrDefaultAsync(ct)
                    .ConfigureAwait(false);

                if (snapshot == null || string.IsNullOrEmpty(snapshot.Data))
                {
                    return (null, null);
                }

                var jwks = JsonSerializer.Deserialize<JsonWebKeySet>(snapshot.Data);
                return (jwks, snapshot.Timestamp);
            }
            catch
            {
                return (null, null);
            }
        }
    }

    /// <summary>
    /// MongoDB document for storing snapshots
    /// </summary>
    public class SnapshotDocument
    {
        /// <summary>
        /// Unique identifier for the snapshot
        /// </summary>
        [BsonId]
        public string Id { get; set; } = string.Empty;

        /// <summary>
        /// JSON serialized snapshot data
        /// </summary>
        [BsonElement("data")]
        public string Data { get; set; } = string.Empty;

        /// <summary>
        /// Signature for signed definitions
        /// </summary>
        [BsonElement("signature")]
        [BsonIgnoreIfNull]
        public string? Signature { get; set; }

        /// <summary>
        /// Key ID for signature verification
        /// </summary>
        [BsonElement("keyId")]
        [BsonIgnoreIfNull]
        public string? KeyId { get; set; }

        /// <summary>
        /// Timestamp of the snapshot
        /// </summary>
        [BsonElement("timestamp")]
        [BsonIgnoreIfNull]
        public long? Timestamp { get; set; }

        /// <summary>
        /// Last update time
        /// </summary>
        [BsonElement("updatedAt")]
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
