using System.Collections.Generic;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Storage.DistributedCache
{
    /// <summary>
    /// Snapshot of the features
    /// </summary>
    public class FeatureSnapshot
    {
        /// <summary>
        /// Id of the snapshot
        /// </summary>
        public string Id { get; set; }


        /// <summary>
        /// Features in the snapshot
        /// </summary>
        public List<FeatureDefinitionModel> Features { get; set; }

        /// <summary>
        /// Signature of the snapshot
        /// </summary>
        public string? Signature { get; set; }

        /// <summary>
        /// KeyId of the signature
        /// </summary>
        public string? KeyId { get; set; }


        /// <summary>
        /// Timestamp of the signature
        /// </summary>
        public long? Timestamp { get; set; }
    }
}
