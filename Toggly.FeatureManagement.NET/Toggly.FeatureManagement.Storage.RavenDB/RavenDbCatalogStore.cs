using System;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Raven.Client.Documents;
using Raven.Client.Exceptions;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Storage.RavenDB
{
    /// <summary>
    /// RavenDB implementation of the authoritative embedded catalog store.
    /// </summary>
    public sealed class RavenDbCatalogStore : ITogglyCatalogStore
    {
        private const string CatalogCollection = "TogglyCatalogs";
        private readonly IDocumentStore _documentStore;

        /// <summary>
        /// Initializes a catalog store using the host-owned RavenDB document store.
        /// </summary>
        /// <param name="documentStore">Initialized RavenDB document store.</param>
        public RavenDbCatalogStore(IDocumentStore documentStore)
        {
            _documentStore = documentStore ?? throw new ArgumentNullException(nameof(documentStore));
        }

        /// <inheritdoc />
        public CatalogStoreCapabilities Capabilities { get; } = new CatalogStoreCapabilities { SupportsMultipleWriters = true };

        /// <inheritdoc />
        public async Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default(CancellationToken))
        {
            var normalizedName = ValidateCatalogName(catalogName);
            using var session = _documentStore.OpenAsyncSession();
            var stored = await session.LoadAsync<CatalogStorageDocument>(GetDocumentId(normalizedName), cancellationToken).ConfigureAwait(false);
            return stored == null ? null : ToSnapshot(stored, normalizedName);
        }

        /// <inheritdoc />
        public async Task<CatalogWriteResult> TryWriteAsync(
            string catalogName,
            CatalogDocument document,
            string? expectedRevision,
            CancellationToken cancellationToken = default(CancellationToken))
        {
            var normalizedName = ValidateCatalogName(catalogName);
            if (document == null) throw new ArgumentNullException(nameof(document));

            var payload = CatalogJson.Serialize(document);
            var normalizedDocument = CatalogJson.Parse(payload);
            var documentId = GetDocumentId(normalizedName);

            using var session = _documentStore.OpenAsyncSession();
            session.Advanced.UseOptimisticConcurrency = true;
            var existing = await session.LoadAsync<CatalogStorageDocument>(documentId, cancellationToken).ConfigureAwait(false);

            if (existing == null)
            {
                if (expectedRevision != null)
                {
                    return CatalogWriteResult.Conflict();
                }

                var created = new CatalogStorageDocument
                {
                    Id = documentId,
                    CatalogName = normalizedName,
                    Revision = NewRevision(),
                    Payload = payload,
                    UpdatedAtUtc = DateTimeOffset.UtcNow
                };
                await session.StoreAsync(created, cancellationToken).ConfigureAwait(false);

                try
                {
                    await session.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
                    return CatalogWriteResult.Written(ToSnapshot(created, normalizedName, normalizedDocument));
                }
                catch (ConcurrencyException)
                {
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
                await session.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
                return CatalogWriteResult.Written(ToSnapshot(existing, normalizedName, normalizedDocument));
            }
            catch (ConcurrencyException)
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

        private static string GetDocumentId(string catalogName) => CatalogCollection + "/" + GetCatalogId(catalogName);

        private static CatalogSnapshot ToSnapshot(CatalogStorageDocument stored, string expectedCatalogName, CatalogDocument? document = null)
        {
            if (!string.Equals(stored.CatalogName, expectedCatalogName, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Catalog identity collision detected.");
            }

            return new CatalogSnapshot
            {
                CatalogName = stored.CatalogName,
                Revision = stored.Revision,
                UpdatedAtUtc = stored.UpdatedAtUtc,
                Document = document ?? CatalogJson.Parse(stored.Payload)
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
