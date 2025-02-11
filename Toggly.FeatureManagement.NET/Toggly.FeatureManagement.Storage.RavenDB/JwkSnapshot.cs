
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Storage.RavenDB
{
    public class JwkSnapshot
    {
        public string Id { get; set; } = string.Empty;

        public JsonWebKeySet Jwks { get; set; } = new JsonWebKeySet();
        
        public long Timestamp { get; set; } = 0;
    }
}