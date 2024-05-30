using Microsoft.FeatureManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;

namespace Toggly.FeatureManagement.Data
{
    /// <summary>
    /// Feature definition model
    /// </summary>
    public class FeatureDefinitionModel : IEquatable<FeatureDefinitionModel>, IEqualityComparer<FeatureDefinitionModel>
    {
        /// <summary>
        /// Unique key of feature
        /// </summary>
        public string FeatureKey { get; set; }

        /// <summary>
        /// List of filters to checked to determine if feature is enabled
        /// </summary>
        public List<FeatureFilter> Filters { get; set; }

        /// <summary>
        /// List of metrics to be tracked
        /// </summary>
        public List<string>? Metrics { get; set; }

        /// <summary>
        /// Feature is meant for security purposes as well
        /// </summary>
        public bool SecuredFeature { get; set; }

        /// <summary>
        /// Require all the filters to be true or at least one
        /// </summary>
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public RequirementType RequirementType { get; set; } = RequirementType.Any;

        /// <summary>
        /// Equality comparer
        /// </summary>
        /// <param name="x"></param>
        /// <param name="y"></param>
        /// <returns></returns>
        public bool Equals(FeatureDefinitionModel? x, FeatureDefinitionModel? y)
        {
            if (x is null || y is null) return false;

            return x.FeatureKey == y.FeatureKey && x.Filters.SequenceEqual(y.Filters);
        }

        /// <summary>
        /// Equality comparer
        /// </summary>
        /// <param name="other"></param>
        /// <returns></returns>
        public bool Equals(FeatureDefinitionModel? other)
        {
            if (other is null) return false;
            return FeatureKey.Equals(other.FeatureKey) && Filters.SequenceEqual(other.Filters);
        }

        /// <summary>
        /// Hash code generator
        /// </summary>
        /// <param name="obj"></param>
        /// <returns></returns>
        public int GetHashCode(FeatureDefinitionModel obj)
        {
            if (obj == null) return 0;
            return obj.FeatureKey.GetHashCode() ^ obj.Filters.GetHashCode();
        }
    }

    /// <summary>
    /// Feature filter
    /// </summary>
    public class FeatureFilter : IEquatable<FeatureFilter>, IEqualityComparer<FeatureFilter>
    {
        /// <summary>
        /// Unique name of filter
        /// </summary>
        public string Name { get; set; }

        /// <summary>
        /// List of parameters for filter
        /// </summary>
        public Dictionary<string, string>? Parameters { get; set; }

        /// <summary>
        /// Equality comparer
        /// </summary>
        /// <param name="x"></param>
        /// <param name="y"></param>
        /// <returns></returns>
        public bool Equals(FeatureFilter? x, FeatureFilter? y)
        {
            if (x is null || y is null) return false;
            return x.Name == y.Name && ((x.Parameters == null && y.Parameters == null) || x.Parameters!.SequenceEqual(y.Parameters!));
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="other"></param>
        /// <returns></returns>
        public bool Equals(FeatureFilter? other)
        {
            if (other is null) return false;
            return Name == other.Name && ((Parameters == null && other.Parameters == null) || Parameters!.SequenceEqual(other.Parameters!));
        }

        /// <summary>
        /// Hash code generator
        /// </summary>
        /// <param name="obj"></param>
        /// <returns></returns>
        public int GetHashCode(FeatureFilter obj)
        {
            if (obj == null) return 0;
            return obj.Name.GetHashCode() ^ (obj.Parameters?.GetHashCode() ?? 2);
        }

        /// <summary>
        /// Returns the requirement name and class type
        /// </summary>
        /// <returns></returns>
        public override string ToString() => $"{Name}-{GetType()}";
    }

    /// <summary>
    /// Always on filter
    /// </summary>
    public class AlwaysOnFilter : FeatureFilter
    {

    }
}
