using System;
using System.Collections.Generic;
using System.Linq;

namespace Toggly.FeatureManagement.Data
{
    public class FeatureDefinitionModel : IEquatable<FeatureDefinitionModel>, IEqualityComparer<FeatureDefinitionModel>
    {
        public string FeatureKey { get; set; }

        public List<FeatureFilter> Filters { get; set; }

        public List<string>? Metrics { get; set; }

        public bool Equals(FeatureDefinitionModel x, FeatureDefinitionModel y)
        {
            return x.FeatureKey == y.FeatureKey && x.Filters.SequenceEqual(y.Filters);
        }

        public bool Equals(FeatureDefinitionModel other)
        {
            if (other is null) return false;
            return FeatureKey.Equals(other.FeatureKey) && Filters.SequenceEqual(other.Filters);
        }

        public int GetHashCode(FeatureDefinitionModel obj)
        {
            if (obj == null) return 0;
            return obj.FeatureKey.GetHashCode() ^ obj.Filters.GetHashCode();
        }
    }

    public class FeatureFilter : IEquatable<FeatureFilter>, IEqualityComparer<FeatureFilter>
    {
        /// <summary>
        /// Unique name of filter
        /// </summary>
        public string Name { get; set; }

        /// <summary>
        /// List of parameters for filter
        /// </summary>
        public Dictionary<string, string> Parameters { get; set; }

        public bool Equals(FeatureFilter x, FeatureFilter y)
        {
            return x.Name == y.Name && x.Parameters.SequenceEqual(y.Parameters);
        }

        public bool Equals(FeatureFilter other)
        {
            if (other is null) return false;
            return Name == other.Name && ((Parameters == null && other.Parameters == null) || Parameters.SequenceEqual(other.Parameters));
        }

        public int GetHashCode(FeatureFilter obj)
        {
            if (obj == null) return 0;
            return obj.Name.GetHashCode() ^ obj.Parameters.GetHashCode();
        }

        /// <summary>
        /// Returns the requirement name and class type
        /// </summary>
        /// <returns></returns>
        public override string ToString() => $"{Name}-{GetType()}";
    }

    public class AlwaysOnFilter : FeatureFilter
    {

    }

    public class SecuredFilter : FeatureFilter
    {

    }
}
