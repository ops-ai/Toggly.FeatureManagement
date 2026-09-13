using System;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Storage.EntityFramework
{
    /// <summary>
    /// Entity Framework implementation of the authoritative embedded catalog store.
    /// </summary>
    public sealed class EntityFrameworkCatalogStore : ITogglyCatalogStore
    {
        private readonly IDbContextFactory<TogglyCatalogDbContext> _contextFactory;

        /// <summary>
        /// Initializes the store with a factory that creates one context for each operation.
        /// </summary>
        public EntityFrameworkCatalogStore(IDbContextFactory<TogglyCatalogDbContext> contextFactory)
        {
            _contextFactory = contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));
        }

        /// <inheritdoc />
        public CatalogStoreCapabilities Capabilities { get; } = new CatalogStoreCapabilities { SupportsMultipleWriters = true };

        /// <inheritdoc />
        public async Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default)
        {
            var normalizedName = ValidateCatalogName(catalogName);
            await using var context = await _contextFactory.CreateDbContextAsync(cancellationToken).ConfigureAwait(false);
            var entity = await context.TogglyCatalogs.AsNoTracking()
                .SingleOrDefaultAsync(catalog => catalog.Id == GetCatalogId(normalizedName), cancellationToken)
                .ConfigureAwait(false);

            return entity == null ? null : ToSnapshot(entity, normalizedName);
        }

        /// <inheritdoc />
        public async Task<CatalogWriteResult> TryWriteAsync(
            string catalogName,
            CatalogDocument document,
            string? expectedRevision,
            CancellationToken cancellationToken = default)
        {
            var normalizedName = ValidateCatalogName(catalogName);
            if (document == null) throw new ArgumentNullException(nameof(document));

            var payload = CatalogJson.Serialize(document);
            var normalizedDocument = CatalogJson.Parse(payload);
            var id = GetCatalogId(normalizedName);

            await using var context = await _contextFactory.CreateDbContextAsync(cancellationToken).ConfigureAwait(false);
            var existing = await context.TogglyCatalogs
                .SingleOrDefaultAsync(catalog => catalog.Id == id, cancellationToken)
                .ConfigureAwait(false);

            if (existing == null)
            {
                if (expectedRevision != null)
                {
                    return CatalogWriteResult.Conflict();
                }

                var created = new CatalogEntity
                {
                    Id = id,
                    CatalogName = normalizedName,
                    Revision = NewRevision(),
                    Payload = payload,
                    UpdatedAtUtc = DateTimeOffset.UtcNow
                };
                context.TogglyCatalogs.Add(created);

                try
                {
                    await context.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
                    return CatalogWriteResult.Written(ToSnapshot(created, normalizedName, normalizedDocument));
                }
                catch (DbUpdateException)
                {
                    // A competing create can surface as a provider-specific unique constraint error rather than concurrency.
                    // Re-read with a fresh context and classify it as a conflict only when the catalog now exists.
                    var current = await ReadAsync(normalizedName, cancellationToken).ConfigureAwait(false);
                    if (current != null)
                    {
                        return CatalogWriteResult.Conflict(current);
                    }

                    throw;
                }
            }

            if (!string.Equals(existing.CatalogName, normalizedName, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Catalog identity collision detected.");
            }

            if (expectedRevision == null || !string.Equals(existing.Revision, expectedRevision, StringComparison.Ordinal))
            {
                return CatalogWriteResult.Conflict(ToSnapshot(existing, normalizedName));
            }

            existing.Payload = payload;
            existing.Revision = NewRevision();
            existing.UpdatedAtUtc = DateTimeOffset.UtcNow;
            try
            {
                await context.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
                return CatalogWriteResult.Written(ToSnapshot(existing, normalizedName, normalizedDocument));
            }
            catch (DbUpdateConcurrencyException)
            {
                return CatalogWriteResult.Conflict(await ReadAsync(normalizedName, cancellationToken).ConfigureAwait(false));
            }
        }

        /// <summary>
        /// Returns the SHA-256 storage key for a logical catalog name.
        /// </summary>
        public static string GetCatalogId(string catalogName)
        {
            var name = ValidateCatalogName(catalogName);
            using var hash = SHA256.Create();
            var bytes = hash.ComputeHash(Encoding.UTF8.GetBytes(name));
            var builder = new StringBuilder(bytes.Length * 2);
            foreach (var value in bytes)
            {
                builder.Append(value.ToString("x2", System.Globalization.CultureInfo.InvariantCulture));
            }

            return builder.ToString();
        }

        private static CatalogSnapshot ToSnapshot(CatalogEntity entity, string expectedCatalogName, CatalogDocument? document = null)
        {
            if (!string.Equals(entity.CatalogName, expectedCatalogName, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Catalog identity collision detected.");
            }

            return new CatalogSnapshot
            {
                CatalogName = entity.CatalogName,
                Revision = entity.Revision,
                UpdatedAtUtc = entity.UpdatedAtUtc,
                Document = document ?? CatalogJson.Parse(entity.Payload)
            };
        }

        private static string ValidateCatalogName(string catalogName)
        {
            if (string.IsNullOrWhiteSpace(catalogName))
            {
                throw new ArgumentException("Catalog name is required.", nameof(catalogName));
            }

            return catalogName;
        }

        private static string NewRevision() => Guid.NewGuid().ToString("D");
    }
}
