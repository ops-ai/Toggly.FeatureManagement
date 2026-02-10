namespace Toggly.FeatureManagement.Storage.MongoDB
{
    /// <summary>
    /// Settings for MongoDB snapshot provider
    /// </summary>
    public class TogglySnapshotSettings
    {
        /// <summary>
        /// Name/ID for the feature snapshot document (default: "toggly_features")
        /// </summary>
        public string DocumentName { get; set; } = "toggly_features";

        /// <summary>
        /// Name/ID for the JWK snapshot document (default: "toggly_jwks")
        /// </summary>
        public string JwkDocumentName { get; set; } = "toggly_jwks";

        /// <summary>
        /// Database name for storing snapshots (default: "toggly")
        /// </summary>
        public string DatabaseName { get; set; } = "toggly";

        /// <summary>
        /// Collection name for storing snapshots (default: "snapshots")
        /// </summary>
        public string CollectionName { get; set; } = "snapshots";
    }
}
