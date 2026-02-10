using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Storage.EntityFramework
{
    /// <summary>
    /// Entity Framework feature snapshot provider
    /// </summary>
    public class EntityFrameworkFeatureSnapshotProvider : IFeatureSnapshotProvider
    {
        private readonly TogglyEntities _context;
        private readonly IOptions<TogglySnapshotSettings> _snapshotSettings;
        private bool _tableEnsured;

        /// <summary>
        /// Constructor
        /// </summary>
        /// <param name="context">Entity Framework DbContext</param>
        /// <param name="snapshotSettings">Snapshot settings</param>
        public EntityFrameworkFeatureSnapshotProvider(TogglyEntities context, IOptions<TogglySnapshotSettings> snapshotSettings)
        {
            _context = context;
            _snapshotSettings = snapshotSettings;
        }

        private async Task EnsureTableExistsAsync(CancellationToken ct)
        {
            if (_tableEnsured || !_snapshotSettings.Value.AutoCreateTable)
                return;

            try
            {
                await _context.Database.EnsureCreatedAsync(ct).ConfigureAwait(false);
                _tableEnsured = true;
            }
            catch
            {
                // Table might already exist, that's fine
                _tableEnsured = true;
            }
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
                await EnsureTableExistsAsync(ct).ConfigureAwait(false);

                var documentName = _snapshotSettings.Value.DocumentName ?? "toggly_features";
                var snapshot = await _context.TogglySnapshots
                    .AsNoTracking()
                    .FirstOrDefaultAsync(s => s.Id == documentName, ct)
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
            await EnsureTableExistsAsync(ct).ConfigureAwait(false);

            var documentName = _snapshotSettings.Value.DocumentName ?? "toggly_features";
            var existingSnapshot = await _context.TogglySnapshots
                .FirstOrDefaultAsync(s => s.Id == documentName, ct)
                .ConfigureAwait(false);

            var jsonData = JsonSerializer.Serialize(features);

            if (existingSnapshot == null)
            {
                var snapshot = new SnapshotEntity
                {
                    Id = documentName,
                    Data = jsonData,
                    Signature = signature,
                    KeyId = keyId,
                    Timestamp = timestamp,
                    UpdatedAt = DateTime.UtcNow
                };
                await _context.TogglySnapshots.AddAsync(snapshot, ct).ConfigureAwait(false);
            }
            else
            {
                existingSnapshot.Data = jsonData;
                existingSnapshot.Signature = signature;
                existingSnapshot.KeyId = keyId;
                existingSnapshot.Timestamp = timestamp;
                existingSnapshot.UpdatedAt = DateTime.UtcNow;
            }

            await _context.SaveChangesAsync(ct).ConfigureAwait(false);
        }

        /// <summary>
        /// Save the snapshot of the JWKs
        /// </summary>
        /// <param name="jwks">JSON Web Key Set</param>
        /// <param name="timestamp">Timestamp of the JWKs</param>
        /// <param name="ct">Cancellation token</param>
        public async Task SaveJwkSnapshot(JsonWebKeySet jwks, long timestamp, CancellationToken ct = default)
        {
            await EnsureTableExistsAsync(ct).ConfigureAwait(false);

            var documentName = _snapshotSettings.Value.JwkDocumentName ?? "toggly_jwks";
            var existingSnapshot = await _context.TogglySnapshots
                .FirstOrDefaultAsync(s => s.Id == documentName, ct)
                .ConfigureAwait(false);

            var jsonData = JsonSerializer.Serialize(jwks);

            if (existingSnapshot == null)
            {
                var snapshot = new SnapshotEntity
                {
                    Id = documentName,
                    Data = jsonData,
                    Timestamp = timestamp,
                    UpdatedAt = DateTime.UtcNow
                };
                await _context.TogglySnapshots.AddAsync(snapshot, ct).ConfigureAwait(false);
            }
            else
            {
                existingSnapshot.Data = jsonData;
                existingSnapshot.Timestamp = timestamp;
                existingSnapshot.UpdatedAt = DateTime.UtcNow;
            }

            await _context.SaveChangesAsync(ct).ConfigureAwait(false);
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
                await EnsureTableExistsAsync(ct).ConfigureAwait(false);

                var documentName = _snapshotSettings.Value.JwkDocumentName ?? "toggly_jwks";
                var snapshot = await _context.TogglySnapshots
                    .AsNoTracking()
                    .FirstOrDefaultAsync(s => s.Id == documentName, ct)
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
}
