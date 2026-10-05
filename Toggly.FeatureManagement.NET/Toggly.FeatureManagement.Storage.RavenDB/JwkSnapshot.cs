
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Storage.RavenDB
{
    /// <summary>
    /// Persisted JSON Web Key Set snapshot used for offline signed-definition verification.
    /// </summary>
    public class JwkSnapshot
    {
        /// <summary>
        /// RavenDB document identifier.
        /// </summary>
        public string Id { get; set; } = string.Empty;

        /// <summary>
        /// JSON Web Key Set captured from the Toggly service.
        /// </summary>
        public JsonWebKeySet Jwks { get; set; } = new JsonWebKeySet();

        /// <summary>
        /// Unix timestamp associated with the key set.
        /// </summary>
        public long Timestamp { get; set; } = 0;
    }
}
