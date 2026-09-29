namespace Toggly.FeatureManagement.Storage.RavenDB
{
    /// <summary>
    /// Configures the RavenDB document names used for persisted feature and JWK snapshots.
    /// </summary>
    public class TogglySnapshotSettings
    {
        /// <summary>
        /// Optional feature snapshot document name. The provider uses its default when this is unset.
        /// </summary>
        public string? DocumentName { get; set; }

        /// <summary>
        /// Optional JWK snapshot document name. The provider uses its default when this is unset.
        /// </summary>
        public string? JwkDocumentName { get; set; }
    }
}
