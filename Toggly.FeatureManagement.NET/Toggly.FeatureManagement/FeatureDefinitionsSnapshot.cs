using System.Collections.Generic;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Persisted feature definitions snapshot, including the exact signed
    /// <c>defs</c> JSON used for signature verification.
    /// </summary>
    public sealed class FeatureDefinitionsSnapshot
    {
        /// <summary>
        /// Convenience typed copy of definitions. When <see cref="SignedDefsJson"/> is set,
        /// this must match that verified payload; on load the SDK rejects the snapshot if they diverge
        /// (storage tampering). Evaluation always uses deserialized <see cref="SignedDefsJson"/>.
        /// </summary>
        public List<FeatureDefinitionModel>? Features { get; set; }

        /// <summary>
        /// Base64 ES256 signature over <c>{SignedDefsJson}|{Timestamp}</c>.
        /// </summary>
        public string? Signature { get; set; }

        /// <summary>
        /// Key id (kid) used to verify <see cref="Signature"/>.
        /// </summary>
        public string? KeyId { get; set; }

        /// <summary>
        /// Unix-seconds timestamp included in the signed payload.
        /// </summary>
        public long? Timestamp { get; set; }

        /// <summary>
        /// Exact JSON text of the signed <c>defs</c> array from the server.
        /// Required for cryptographic verification after a storage round-trip.
        /// </summary>
        public string? SignedDefsJson { get; set; }

        /// <summary>
        /// Definitions revision (ETag / X-Definitions-Revision) for conditional fetches.
        /// </summary>
        public string? ETag { get; set; }
    }
}
