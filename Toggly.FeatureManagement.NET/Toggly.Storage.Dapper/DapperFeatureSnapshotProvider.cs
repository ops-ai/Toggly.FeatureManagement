using Dapper;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Generic;
using System.Data;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Storage.Dapper
{
    /// <summary>
    /// Dapper-based feature snapshot provider for SQL databases
    /// </summary>
    public class DapperFeatureSnapshotProvider : IFeatureSnapshotProvider
    {
        private readonly Func<IDbConnection> _connectionFactory;
        private readonly IOptions<TogglySnapshotSettings> _snapshotSettings;
        private bool _tableEnsured;

        /// <summary>
        /// Constructor
        /// </summary>
        /// <param name="connectionFactory">Factory function to create database connections</param>
        /// <param name="snapshotSettings">Snapshot settings</param>
        public DapperFeatureSnapshotProvider(
            Func<IDbConnection> connectionFactory,
            IOptions<TogglySnapshotSettings> snapshotSettings)
        {
            _connectionFactory = connectionFactory ?? throw new ArgumentNullException(nameof(connectionFactory));
            _snapshotSettings = snapshotSettings;
        }

        private async Task EnsureTableExistsAsync()
        {
            if (_tableEnsured || !_snapshotSettings.Value.AutoCreateTable)
                return;

            try
            {
                using var connection = _connectionFactory();
                var sql = GetCreateTableSql();
                await connection.ExecuteAsync(sql).ConfigureAwait(false);
                _tableEnsured = true;
            }
            catch
            {
                // Table might already exist, that's fine
                _tableEnsured = true;
            }
        }

        private string GetCreateTableSql()
        {
            var tableName = _snapshotSettings.Value.TableName;

            return _snapshotSettings.Value.Provider switch
            {
                DatabaseProvider.PostgreSql => $@"
                    CREATE TABLE IF NOT EXISTS ""{tableName}"" (
                        ""Id"" VARCHAR(100) NOT NULL PRIMARY KEY,
                        ""Data"" TEXT NOT NULL,
                        ""Signature"" VARCHAR(1000) NULL,
                        ""KeyId"" VARCHAR(100) NULL,
                        ""Timestamp"" BIGINT NULL,
                        ""UpdatedAt"" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )",
                DatabaseProvider.MySql => $@"
                    CREATE TABLE IF NOT EXISTS `{tableName}` (
                        `Id` VARCHAR(100) NOT NULL PRIMARY KEY,
                        `Data` LONGTEXT NOT NULL,
                        `Signature` VARCHAR(1000) NULL,
                        `KeyId` VARCHAR(100) NULL,
                        `Timestamp` BIGINT NULL,
                        `UpdatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )",
                DatabaseProvider.Sqlite => $@"
                    CREATE TABLE IF NOT EXISTS ""{tableName}"" (
                        ""Id"" TEXT NOT NULL PRIMARY KEY,
                        ""Data"" TEXT NOT NULL,
                        ""Signature"" TEXT NULL,
                        ""KeyId"" TEXT NULL,
                        ""Timestamp"" INTEGER NULL,
                        ""UpdatedAt"" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )",
                _ => $@"
                    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '{tableName}')
                    CREATE TABLE [{tableName}] (
                        [Id] NVARCHAR(100) NOT NULL PRIMARY KEY,
                        [Data] NVARCHAR(MAX) NOT NULL,
                        [Signature] NVARCHAR(1000) NULL,
                        [KeyId] NVARCHAR(100) NULL,
                        [Timestamp] BIGINT NULL,
                        [UpdatedAt] DATETIME2 NOT NULL DEFAULT GETUTCDATE()
                    )"
            };
        }

        private string GetSelectSql(string id)
        {
            var tableName = _snapshotSettings.Value.TableName;

            return _snapshotSettings.Value.Provider switch
            {
                DatabaseProvider.PostgreSql => $@"SELECT ""Id"", ""Data"", ""Signature"", ""KeyId"", ""Timestamp"", ""UpdatedAt"" FROM ""{tableName}"" WHERE ""Id"" = @Id",
                DatabaseProvider.MySql => $@"SELECT `Id`, `Data`, `Signature`, `KeyId`, `Timestamp`, `UpdatedAt` FROM `{tableName}` WHERE `Id` = @Id",
                DatabaseProvider.Sqlite => $@"SELECT ""Id"", ""Data"", ""Signature"", ""KeyId"", ""Timestamp"", ""UpdatedAt"" FROM ""{tableName}"" WHERE ""Id"" = @Id",
                _ => $@"SELECT [Id], [Data], [Signature], [KeyId], [Timestamp], [UpdatedAt] FROM [{tableName}] WHERE [Id] = @Id"
            };
        }

        private string GetUpsertSql()
        {
            var tableName = _snapshotSettings.Value.TableName;

            return _snapshotSettings.Value.Provider switch
            {
                DatabaseProvider.PostgreSql => $@"
                    INSERT INTO ""{tableName}"" (""Id"", ""Data"", ""Signature"", ""KeyId"", ""Timestamp"", ""UpdatedAt"")
                    VALUES (@Id, @Data, @Signature, @KeyId, @Timestamp, @UpdatedAt)
                    ON CONFLICT (""Id"") DO UPDATE SET
                        ""Data"" = EXCLUDED.""Data"",
                        ""Signature"" = EXCLUDED.""Signature"",
                        ""KeyId"" = EXCLUDED.""KeyId"",
                        ""Timestamp"" = EXCLUDED.""Timestamp"",
                        ""UpdatedAt"" = EXCLUDED.""UpdatedAt""",
                DatabaseProvider.MySql => $@"
                    INSERT INTO `{tableName}` (`Id`, `Data`, `Signature`, `KeyId`, `Timestamp`, `UpdatedAt`)
                    VALUES (@Id, @Data, @Signature, @KeyId, @Timestamp, @UpdatedAt)
                    ON DUPLICATE KEY UPDATE
                        `Data` = VALUES(`Data`),
                        `Signature` = VALUES(`Signature`),
                        `KeyId` = VALUES(`KeyId`),
                        `Timestamp` = VALUES(`Timestamp`),
                        `UpdatedAt` = VALUES(`UpdatedAt`)",
                DatabaseProvider.Sqlite => $@"
                    INSERT OR REPLACE INTO ""{tableName}"" (""Id"", ""Data"", ""Signature"", ""KeyId"", ""Timestamp"", ""UpdatedAt"")
                    VALUES (@Id, @Data, @Signature, @KeyId, @Timestamp, @UpdatedAt)",
                _ => $@"
                    MERGE [{tableName}] AS target
                    USING (SELECT @Id AS Id, @Data AS Data, @Signature AS Signature, @KeyId AS KeyId, @Timestamp AS [Timestamp], @UpdatedAt AS UpdatedAt) AS source
                    ON target.[Id] = source.Id
                    WHEN MATCHED THEN
                        UPDATE SET [Data] = source.Data, [Signature] = source.Signature, [KeyId] = source.KeyId, [Timestamp] = source.[Timestamp], [UpdatedAt] = source.UpdatedAt
                    WHEN NOT MATCHED THEN
                        INSERT ([Id], [Data], [Signature], [KeyId], [Timestamp], [UpdatedAt])
                        VALUES (source.Id, source.Data, source.Signature, source.KeyId, source.[Timestamp], source.UpdatedAt);"
            };
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
                await EnsureTableExistsAsync().ConfigureAwait(false);

                using var connection = _connectionFactory();
                var documentName = _snapshotSettings.Value.DocumentName;
                var sql = GetSelectSql(documentName);
                var snapshot = await connection.QueryFirstOrDefaultAsync<SnapshotRecord>(sql, new { Id = documentName }).ConfigureAwait(false);

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
            await EnsureTableExistsAsync().ConfigureAwait(false);

            using var connection = _connectionFactory();
            var sql = GetUpsertSql();
            var jsonData = JsonSerializer.Serialize(features);

            await connection.ExecuteAsync(sql, new
            {
                Id = _snapshotSettings.Value.DocumentName,
                Data = jsonData,
                Signature = signature,
                KeyId = keyId,
                Timestamp = timestamp,
                UpdatedAt = DateTime.UtcNow
            }).ConfigureAwait(false);
        }

        /// <summary>
        /// Save the snapshot of the JWKs
        /// </summary>
        /// <param name="jwks">JSON Web Key Set</param>
        /// <param name="timestamp">Timestamp of the JWKs</param>
        /// <param name="ct">Cancellation token</param>
        public async Task SaveJwkSnapshot(JsonWebKeySet jwks, long timestamp, CancellationToken ct = default)
        {
            await EnsureTableExistsAsync().ConfigureAwait(false);

            using var connection = _connectionFactory();
            var sql = GetUpsertSql();
            var jsonData = JsonSerializer.Serialize(jwks);

            await connection.ExecuteAsync(sql, new
            {
                Id = _snapshotSettings.Value.JwkDocumentName,
                Data = jsonData,
                Signature = (string?)null,
                KeyId = (string?)null,
                Timestamp = timestamp,
                UpdatedAt = DateTime.UtcNow
            }).ConfigureAwait(false);
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
                await EnsureTableExistsAsync().ConfigureAwait(false);

                using var connection = _connectionFactory();
                var documentName = _snapshotSettings.Value.JwkDocumentName;
                var sql = GetSelectSql(documentName);
                var snapshot = await connection.QueryFirstOrDefaultAsync<SnapshotRecord>(sql, new { Id = documentName }).ConfigureAwait(false);

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

        private class SnapshotRecord
        {
            public string Id { get; set; } = string.Empty;
            public string Data { get; set; } = string.Empty;
            public string? Signature { get; set; }
            public string? KeyId { get; set; }
            public long? Timestamp { get; set; }
            public DateTime UpdatedAt { get; set; }
        }
    }
}
