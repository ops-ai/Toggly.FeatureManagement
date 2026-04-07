using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Toggly.FeatureManagement.Data
{
    /// <summary>
    /// Signed definitions response
    /// </summary>
    public class SignedDefinitionsResponse
    {
        /// <summary>
        /// List of feature definitions
        /// </summary>
        [JsonPropertyName("defs")]
        public List<FeatureDefinitionModel>? Defs { get; set; }

        /// <summary>
        /// Signature of the definitions
        /// </summary>
        [JsonPropertyName("signature")]
        public string? Signature { get; set; }

        /// <summary>
        /// Timestamp of the definitions
        /// </summary>
        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        /// <summary>
        /// Key Id of the signature
        /// </summary>
        [JsonPropertyName("kid")]
        public string? Kid { get; set; }
    }
}
