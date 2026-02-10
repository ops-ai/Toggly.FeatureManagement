namespace Toggly.FeatureManagement.Storage.Dapper
{
    /// <summary>
    /// Settings for Dapper snapshot provider
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
        /// Table name for storing snapshots (default: "TogglySnapshots")
        /// </summary>
        public string TableName { get; set; } = "TogglySnapshots";

        /// <summary>
        /// Whether to automatically create the table if it doesn't exist (default: true)
        /// </summary>
        public bool AutoCreateTable { get; set; } = true;

        /// <summary>
        /// Database provider type for SQL dialect (default: SqlServer)
        /// </summary>
        public DatabaseProvider Provider { get; set; } = DatabaseProvider.SqlServer;
    }

    /// <summary>
    /// Supported database providers
    /// </summary>
    public enum DatabaseProvider
    {
        /// <summary>Microsoft SQL Server</summary>
        SqlServer,
        /// <summary>PostgreSQL</summary>
        PostgreSql,
        /// <summary>MySQL / MariaDB</summary>
        MySql,
        /// <summary>SQLite</summary>
        Sqlite
    }
}
