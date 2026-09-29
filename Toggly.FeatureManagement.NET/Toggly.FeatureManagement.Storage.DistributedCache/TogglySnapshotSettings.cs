namespace Toggly.FeatureManagement.Storage.DistributedCache
{
    /// <summary>
    /// Cache entry names for persisted feature and signing-key snapshots.
    /// </summary>
    public class TogglySnapshotSettings
    {
        /// <summary>Optional feature snapshot key; defaults to FeatureSnapshots.</summary>
        public string? DocumentName { get; set; }

        /// <summary>Optional signing-key snapshot key; defaults to JwkSnapshots.</summary>
        public string? JwkDocumentName { get; set; }
    }
}
