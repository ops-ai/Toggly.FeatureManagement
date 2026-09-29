
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Storage.DistributedCache
{
    /// <summary>
    /// Persisted signing keys and their expiration timestamp.
    /// </summary>
    public class JwkSnapshot
    {
        /// <summary>Gets or sets the snapshot identifier.</summary>
        public string Id { get; set; } = string.Empty;

        /// <summary>Gets or sets the signing keys.</summary>
        public JsonWebKeySet Jwks { get; set; } = new JsonWebKeySet();

        /// <summary>Gets or sets the Unix expiration timestamp.</summary>
        public long Timestamp { get; set; } = 0;
    }
}
