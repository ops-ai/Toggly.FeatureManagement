using System.Collections.Generic;

namespace Toggly.FeatureManagement
{
    internal class FeatureDefinitionModel
    {
        public string Name { get; set; }

        public string FeatureKey { get; set; }

        public string? Description { get; set; }

        public List<FeatureFilter> Filters { get; set; }
    }

    internal class FeatureFilter
    {
        /// <summary>
        /// Unique name of filter
        /// </summary>
        public string Name { get; set; }

        public Dictionary<string, string> Parameters { get; set; }

        /// <summary>
        /// Returns the requirement name and class type
        /// </summary>
        /// <returns></returns>
        public override string ToString() => $"{Name}-{GetType()}";
    }

    internal class AlwaysOnFilter : FeatureFilter
    {

    }

    internal class AlwaysOffFilter : FeatureFilter
    {

    }
}
