using System.Collections.Generic;

namespace Toggly.FeatureManagement.Data
{
    /// <summary>
    /// JSON Web Key Set
    /// </summary>
    public class JsonWebKeySet
    {
        /// <summary>
        /// JWK array from a JWKS document; may be null when absent or not yet deserialized.
        /// </summary>
        public List<JsonWebKey>? Keys { get; set; }
    }
}