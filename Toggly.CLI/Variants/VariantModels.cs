using System.Text.Json.Serialization;

namespace Toggly.CLI.Variants;

/// <summary>
/// Wire shape for a feature variant, mirroring <c>Toggly.Services.Data.FeatureVariant</c>.
/// </summary>
public class VariantModel
{
    /// <summary>Unique name identifying this variant within the feature.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; set; }

    /// <summary>Configuration value for this variant (string, number, boolean, or object).</summary>
    [JsonPropertyName("configurationValue")]
    public object? ConfigurationValue { get; set; }

    /// <summary>One of "None" (default), "Enabled", or "Disabled". Explicit JSON null is rejected.</summary>
    [JsonPropertyName("statusOverride")]
    public string? StatusOverride { get; set; } = "None";
}

/// <summary>
/// Wire shape for variant allocation, mirroring <c>Toggly.Services.Data.FeatureVariantAllocation</c>.
/// </summary>
public class VariantAllocationModel
{
    /// <summary>Variant assigned when the feature is enabled and no other allocation matches.</summary>
    [JsonPropertyName("defaultWhenEnabled")]
    public string? DefaultWhenEnabled { get; set; }

    /// <summary>Variant assigned when the feature is disabled.</summary>
    [JsonPropertyName("defaultWhenDisabled")]
    public string? DefaultWhenDisabled { get; set; }

    /// <summary>Allocations that assign variants to specific users by identity.</summary>
    [JsonPropertyName("user")]
    public List<UserAllocationModel>? User { get; set; }

    /// <summary>Allocations that assign variants to users in specific groups.</summary>
    [JsonPropertyName("group")]
    public List<GroupAllocationModel>? Group { get; set; }

    /// <summary>Allocations that assign variants based on a percentile bucket.</summary>
    [JsonPropertyName("percentile")]
    public List<PercentileAllocationModel>? Percentile { get; set; }

    /// <summary>Seed value for consistent percentile hashing across features.</summary>
    [JsonPropertyName("seed")]
    public string? Seed { get; set; }
}

/// <summary>Assigns a variant to a specific list of users by identity.</summary>
public class UserAllocationModel
{
    /// <summary>Name of the variant to assign.</summary>
    [JsonPropertyName("variant")]
    public required string Variant { get; set; }

    /// <summary>List of user identifiers to receive this variant.</summary>
    [JsonPropertyName("users")]
    public required List<string> Users { get; set; }
}

/// <summary>Assigns a variant to users belonging to specific groups.</summary>
public class GroupAllocationModel
{
    /// <summary>Name of the variant to assign.</summary>
    [JsonPropertyName("variant")]
    public required string Variant { get; set; }

    /// <summary>List of group names whose members receive this variant.</summary>
    [JsonPropertyName("groups")]
    public required List<string> Groups { get; set; }
}

/// <summary>Assigns a variant to users whose computed percentile falls within a range.</summary>
public class PercentileAllocationModel
{
    /// <summary>Name of the variant to assign.</summary>
    [JsonPropertyName("variant")]
    public required string Variant { get; set; }

    /// <summary>Start of the percentile range (inclusive, 0-100).</summary>
    [JsonPropertyName("from")]
    public double From { get; set; }

    /// <summary>End of the percentile range (exclusive, 0-100).</summary>
    [JsonPropertyName("to")]
    public double To { get; set; }
}
