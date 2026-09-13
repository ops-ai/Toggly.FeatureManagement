using System;

namespace Toggly.FeatureManagement.Storage.RavenDB
{
    /// <summary>
    /// RavenDB envelope for an authoritative embedded catalog. The portable payload stays separate from storage identity and concurrency metadata.
    /// </summary>
    public sealed class CatalogStorageDocument
    {
        /// <summary>
        /// RavenDB document ID in the <c>TogglyCatalogs/{sha256}</c> collection.
        /// </summary>
        public string Id { get; set; } = string.Empty;

        /// <summary>
        /// Original logical catalog name.
        /// </summary>
        public string CatalogName { get; set; } = string.Empty;

        /// <summary>
        /// Application-managed opaque catalog revision.
        /// </summary>
        public string Revision { get; set; } = string.Empty;

        /// <summary>
        /// Canonical portable catalog JSON.
        /// </summary>
        public string Payload { get; set; } = string.Empty;

        /// <summary>
        /// Time of the successful conditional write in UTC.
        /// </summary>
        public DateTimeOffset UpdatedAtUtc { get; set; }
    }
}
