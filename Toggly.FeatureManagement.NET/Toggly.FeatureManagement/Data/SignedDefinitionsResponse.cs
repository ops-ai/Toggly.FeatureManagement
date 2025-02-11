using System.Collections.Generic;

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
        public List<FeatureDefinitionModel> Defs { get; set; }

        /// <summary>
        /// Signature of the definitions
        /// </summary>
        public string Signature { get; set; }

        /// <summary>
        /// Timestamp of the definitions
        /// </summary>
        public long Timestamp { get; set; }

        /// <summary>
        /// Key Id of the signature
        /// </summary>
        public string Kid { get; set; }
    }
}
