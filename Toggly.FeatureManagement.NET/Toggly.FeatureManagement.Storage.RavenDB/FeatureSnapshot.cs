using System.Collections.Generic;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Storage.RavenDB
{
    public class FeatureSnapshot
    {
        public string Id { get; set; }

        public List<FeatureDefinitionModel> Features { get; set; }
    }
}
