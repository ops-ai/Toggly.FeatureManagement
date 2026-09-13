using System.Threading;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.Catalog
{
    /// <summary>
    /// Storage capabilities exposed by a catalog provider.
    /// </summary>
    public sealed class CatalogStoreCapabilities
    {
        /// <summary>
        /// Gets or sets whether the provider provides safe optimistic concurrency across multiple writers.
        /// </summary>
        public bool SupportsMultipleWriters { get; set; }

        /// <summary>
        /// Gets or sets whether this registration rejects writes, independently of concurrency support.
        /// Allows dashboards to reject an editable mount against a reader without depending on provider types.
        /// </summary>
        public bool IsReadOnly { get; set; }
    }

    /// <summary>
    /// Result status for a catalog write attempt.
    /// </summary>
    public enum CatalogWriteStatus
    {
        /// <summary>The document was committed.</summary>
        Written,

        /// <summary>The supplied revision did not match the current document.</summary>
        Conflict
    }

    /// <summary>
    /// Result from a conditional catalog write.
    /// </summary>
    public sealed class CatalogWriteResult
    {
        public CatalogWriteStatus Status { get; private set; }

        public CatalogSnapshot? Snapshot { get; private set; }

        /// <summary>
        /// Creates a successful write result containing the committed snapshot.
        /// </summary>
        public static CatalogWriteResult Written(CatalogSnapshot snapshot)
        {
            return new CatalogWriteResult { Status = CatalogWriteStatus.Written, Snapshot = snapshot };
        }

        /// <summary>
        /// Creates a conflict result containing the current snapshot when the provider could obtain it.
        /// </summary>
        public static CatalogWriteResult Conflict(CatalogSnapshot? snapshot = null)
        {
            return new CatalogWriteResult { Status = CatalogWriteStatus.Conflict, Snapshot = snapshot };
        }
    }

    /// <summary>
    /// Reads and conditionally writes authoritative portable feature catalogs.
    /// </summary>
    public interface ITogglyCatalogStore
    {
        /// <summary>
        /// Gets provider concurrency capabilities.
        /// </summary>
        CatalogStoreCapabilities Capabilities { get; }

        /// <summary>
        /// Reads a catalog, returning <c>null</c> only when the catalog is genuinely absent.
        /// </summary>
        Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default(CancellationToken));

        /// <summary>
        /// Creates a missing catalog when <paramref name="expectedRevision"/> is <c>null</c>, or replaces the
        /// catalog only when that opaque revision remains current.
        /// </summary>
        Task<CatalogWriteResult> TryWriteAsync(
            string catalogName,
            CatalogDocument document,
            string? expectedRevision,
            CancellationToken cancellationToken = default(CancellationToken));
    }
}
