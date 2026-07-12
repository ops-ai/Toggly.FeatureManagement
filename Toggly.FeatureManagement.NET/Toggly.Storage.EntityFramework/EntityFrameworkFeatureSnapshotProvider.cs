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
                await EnsureColumnsExistAsync(ct).ConfigureAwait(false);
                _tableEnsured = true;
            }
            catch
            {
                // Table might already exist; still try to add missing columns for upgrades.
                try
                {
                    await EnsureColumnsExistAsync(ct).ConfigureAwait(false);
                }
                catch
                {
                    // Best effort
                }

                _tableEnsured = true;
            }
        }

        /// <summary>
        /// Adds SignedDefsJson / ETag when upgrading from pre-3.3.0 schemas.
        /// EnsureCreatedAsync does not alter existing tables.
        /// </summary>
        private async Task EnsureColumnsExistAsync(CancellationToken ct)
        {
            var provider = _context.Database.ProviderName ?? string.Empty;
            IEnumerable<string> statements;

            if (provider.Contains("Sqlite", StringComparison.OrdinalIgnoreCase))
            {
                statements = new[]
                {
                    "ALTER TABLE \"TogglySnapshots\" ADD COLUMN \"SignedDefsJson\" TEXT NULL",
                    "ALTER TABLE \"TogglySnapshots\" ADD COLUMN \"ETag\" TEXT NULL"
                };
            }
            else if (provider.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) ||
                     provider.Contains("Postgre", StringComparison.OrdinalIgnoreCase))
            {
                statements = new[]
                {
                    "ALTER TABLE \"TogglySnapshots\" ADD COLUMN IF NOT EXISTS \"SignedDefsJson\" TEXT NULL",
                    "ALTER TABLE \"TogglySnapshots\" ADD COLUMN IF NOT EXISTS \"ETag\" VARCHAR(255) NULL"
                };
            }
            else if (provider.Contains("MySql", StringComparison.OrdinalIgnoreCase) ||
                     provider.Contains("MariaDb", StringComparison.OrdinalIgnoreCase))
            {
                statements = new[]
                {
                    "ALTER TABLE `TogglySnapshots` ADD COLUMN `SignedDefsJson` LONGTEXT NULL",
                    "ALTER TABLE `TogglySnapshots` ADD COLUMN `ETag` VARCHAR(255) NULL"
                };
            }
            else
            {
                // SQL Server and others
                statements = new[]
                {
                    "IF COL_LENGTH('TogglySnapshots', 'SignedDefsJson') IS NULL ALTER TABLE [TogglySnapshots] ADD [SignedDefsJson] NVARCHAR(MAX) NULL",
                    "IF COL_LENGTH('TogglySnapshots', 'ETag') IS NULL ALTER TABLE [TogglySnapshots] ADD [ETag] NVARCHAR(255) NULL"
                };
            }

            foreach (var sql in statements)
            {
                try
                {
                    await _context.Database.ExecuteSqlRawAsync(sql, ct).ConfigureAwait(false);
                }
                catch
                {
                    // Column already exists
                }
            }
        }

        /// <summary>
        /// Get the snapshot of the features
        /// </summary>
        /// <param name="ct">Cancellation token</param>
        /// <returns>Feature snapshot with signature metadata</returns>
        public async Task<FeatureDefinitionsSnapshot?> GetFeaturesSnapshotAsync(CancellationToken ct = default)
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
                    return null;
                }

                var features = JsonSerializer.Deserialize<List<FeatureDefinitionModel>>(snapshot.Data);
                return new FeatureDefinitionsSnapshot
                {
                    Features = features,
                    Signature = snapshot.Signature,
                    KeyId = snapshot.KeyId,
                    Timestamp = snapshot.Timestamp,
                    SignedDefsJson = snapshot.SignedDefsJson,
                    ETag = snapshot.ETag
                };
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Save the snapshot of the features
        /// </summary>
        /// <param name="snapshot">Feature definitions snapshot</param>
        /// <param name="ct">Cancellation token</param>
        public async Task SaveSnapshotAsync(FeatureDefinitionsSnapshot snapshot, CancellationToken ct = default)
        {
            await EnsureTableExistsAsync(ct).ConfigureAwait(false);

            var documentName = _snapshotSettings.Value.DocumentName ?? "toggly_features";
            var existingSnapshot = await _context.TogglySnapshots
                .FirstOrDefaultAsync(s => s.Id == documentName, ct)
                .ConfigureAwait(false);

            var jsonData = JsonSerializer.Serialize(snapshot.Features);

            if (existingSnapshot == null)
            {
                var entity = new SnapshotEntity
                {
                    Id = documentName,
                    Data = jsonData,
                    Signature = snapshot.Signature,
                    KeyId = snapshot.KeyId,
                    Timestamp = snapshot.Timestamp,
                    SignedDefsJson = snapshot.SignedDefsJson,
                    ETag = snapshot.ETag,
                    UpdatedAt = DateTime.UtcNow
                };
                await _context.TogglySnapshots.AddAsync(entity, ct).ConfigureAwait(false);
            }
            else
            {
                existingSnapshot.Data = jsonData;
                existingSnapshot.Signature = snapshot.Signature;
                existingSnapshot.KeyId = snapshot.KeyId;
                existingSnapshot.Timestamp = snapshot.Timestamp;
                existingSnapshot.SignedDefsJson = snapshot.SignedDefsJson;
                existingSnapshot.ETag = snapshot.ETag;
                existingSnapshot.UpdatedAt = DateTime.UtcNow;
            }

            await _context.SaveChangesAsync(ct).ConfigureAwait(false);
        }

        /// <summary>
        /// Delete the persisted feature definitions snapshot.
        /// </summary>
        /// <param name="ct">Cancellation token</param>
        public async Task ClearSnapshotAsync(CancellationToken ct = default)
        {
            await EnsureTableExistsAsync(ct).ConfigureAwait(false);

            var documentName = _snapshotSettings.Value.DocumentName ?? "toggly_features";
            var existingSnapshot = await _context.TogglySnapshots
                .FirstOrDefaultAsync(s => s.Id == documentName, ct)
                .ConfigureAwait(false);

            if (existingSnapshot != null)
            {
                _context.TogglySnapshots.Remove(existingSnapshot);
                await _context.SaveChangesAsync(ct).ConfigureAwait(false);
            }
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

        /// <summary>
        /// Delete the persisted JWKS snapshot.
        /// </summary>
        /// <param name="ct">Cancellation token</param>
        public async Task ClearJwkSnapshotAsync(CancellationToken ct = default)
        {
            await EnsureTableExistsAsync(ct).ConfigureAwait(false);

            var documentName = _snapshotSettings.Value.JwkDocumentName ?? "toggly_jwks";
            var existingSnapshot = await _context.TogglySnapshots
                .FirstOrDefaultAsync(s => s.Id == documentName, ct)
                .ConfigureAwait(false);

            if (existingSnapshot != null)
            {
                _context.TogglySnapshots.Remove(existingSnapshot);
                await _context.SaveChangesAsync(ct).ConfigureAwait(false);
            }
        }
    }
}
