using System.Collections.Generic;

namespace Toggly.FeatureManagement.Data
{
    /// <summary>
    /// JSON Web Key Set
    /// </summary>
    public class JsonWebKeySet
    {
        public List<JsonWebKey> Keys { get; set; }
    }
}