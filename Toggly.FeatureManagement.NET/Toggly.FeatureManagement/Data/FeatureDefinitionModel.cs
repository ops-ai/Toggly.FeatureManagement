using Microsoft.FeatureManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
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
        /// Named variants (Microsoft Feature Management schema); used by <see cref="IVariantFeatureManager"/>.
        /// </summary>
        public List<VariantDefinition>? Variants { get; set; }

        /// <summary>
        /// Variant allocation rules (Microsoft Feature Management schema).
        /// </summary>
        public AllocationDefinition? Allocation { get; set; }

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
            unchecked
            {
                int hash = obj.FeatureKey?.GetHashCode() ?? 0;
                if (obj.Filters != null)
                {
                    foreach (var filter in obj.Filters)
                    {
                        hash ^= filter.GetHashCode(filter);
                    }
                }
                return hash;
            }
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
            unchecked
            {
                int hash = obj.Name?.GetHashCode() ?? 0;
                if (obj.Parameters != null)
                {
                    foreach (var kvp in obj.Parameters.OrderBy(k => k.Key))
                    {
                        hash ^= kvp.Key.GetHashCode() ^ (kvp.Value?.GetHashCode() ?? 0);
                    }
                }
                return hash;
            }
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

    /// <summary>
    /// Deserialized variant definition; mirrors <see cref="Microsoft.FeatureManagement.VariantDefinition"/>.
    /// </summary>
    public class VariantDefinition
    {
        /// <summary>Name of the variant.</summary>
        public string Name { get; set; } = string.Empty;

        /// <summary>JSON configuration payload for this variant.</summary>
        public JsonElement ConfigurationValue { get; set; }

        /// <summary>Optional enabled/disabled override when this variant is assigned.</summary>
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public StatusOverride StatusOverride { get; set; } = StatusOverride.None;
    }

    /// <summary>
    /// Deserialized allocation; mirrors <see cref="Microsoft.FeatureManagement.Allocation"/>.
    /// </summary>
    public class AllocationDefinition
    {
        /// <summary>Default variant when the feature is enabled and no rule matches.</summary>
        public string? DefaultWhenEnabled { get; set; }

        /// <summary>Default variant when the feature is disabled.</summary>
        public string? DefaultWhenDisabled { get; set; }

        /// <summary>Per-user variant assignments.</summary>
        public List<UserAllocationDefinition>? User { get; set; }

        /// <summary>Per-group variant assignments.</summary>
        public List<GroupAllocationDefinition>? Group { get; set; }

        /// <summary>Percentile-based assignments.</summary>
        public List<PercentileAllocationDefinition>? Percentile { get; set; }

        /// <summary>Seed for consistent percentile hashing across features.</summary>
        public string? Seed { get; set; }
    }

    /// <summary>
    /// Mirrors <see cref="Microsoft.FeatureManagement.UserAllocation"/>.
    /// </summary>
    public class UserAllocationDefinition
    {
        /// <summary>Variant name to assign.</summary>
        public string? Variant { get; set; }

        /// <summary>User identifiers receiving this variant.</summary>
        public List<string>? Users { get; set; }
    }

    /// <summary>
    /// Mirrors <see cref="Microsoft.FeatureManagement.GroupAllocation"/>.
    /// </summary>
    public class GroupAllocationDefinition
    {
        /// <summary>Variant name to assign.</summary>
        public string? Variant { get; set; }

        /// <summary>Group names receiving this variant.</summary>
        public List<string>? Groups { get; set; }
    }

    /// <summary>
    /// Mirrors <see cref="Microsoft.FeatureManagement.PercentileAllocation"/>.
    /// </summary>
    public class PercentileAllocationDefinition
    {
        /// <summary>Variant name to assign.</summary>
        public string? Variant { get; set; }

        /// <summary>Inclusive lower bound (0–100).</summary>
        public double From { get; set; }

        /// <summary>Exclusive upper bound (0–100).</summary>
        public double To { get; set; }
    }
}
