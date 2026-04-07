namespace Toggly.FeatureManagement.Data
{
    /// <summary>
    /// JSON Web Key
    /// </summary>
    public class JsonWebKey
    {
        /// <summary>
        /// Key type
        /// </summary>
        public string? Kty { get; set; }

        /// <summary>
        /// Key use
        /// </summary>
        public string Use { get; set; } = "sig";

        /// <summary>
        /// Key ID
        /// </summary>
        public string? Kid { get; set; }

        /// <summary>
        /// Curve
        /// </summary>
        public string? Crv { get; set; }

        /// <summary>
        /// X coordinate
        /// </summary>
        public string? X { get; set; }

        /// <summary>
        /// Y coordinate
        /// </summary>
        public string? Y { get; set; }

        /// <summary>
        /// Algorithm
        /// </summary>
        public string? Alg { get; set; }
    } 
}