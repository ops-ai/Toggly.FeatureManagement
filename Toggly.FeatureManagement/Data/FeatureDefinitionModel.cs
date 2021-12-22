using System.Collections.Generic;

namespace Toggly.FeatureManagement.Data
{
    public class FeatureDefinitionModel
    {
        public string Name { get; set; }

        public string FeatureKey { get; set; }

        public string? Description { get; set; }

        public List<FeatureFilter> Filters { get; set; }
    }

    public class FeatureFilter
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

    public class AlwaysOnFilter : FeatureFilter
    {

    }

    public class AlwaysOffFilter : FeatureFilter
    {

    }
}
