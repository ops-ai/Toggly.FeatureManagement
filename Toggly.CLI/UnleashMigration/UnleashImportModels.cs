using System.Text.Json.Serialization;

namespace Toggly.CLI.UnleashMigration;

/// <summary>
/// Root DTO for an Unleash project/environment export or Admin API feature list payload.
/// </summary>
public class UnleashFeatureExport
{
    /// <summary>Exported features (file export shape).</summary>
    [JsonPropertyName("features")]
    public List<UnleashFeatureDto>? Features { get; set; }
}

/// <summary>
/// Unleash feature flag payload used during import mapping.
/// </summary>
public class UnleashFeatureDto
{
    /// <summary>Feature key / name.</summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>Whether the feature is enabled in the source environment.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    /// <summary>Optional description.</summary>
    [JsonPropertyName("description")]
    public string? Description { get; set; }

    /// <summary>Unleash feature type (release, experiment, etc.).</summary>
    [JsonPropertyName("type")]
    public string? Type { get; set; }

    /// <summary>Source Unleash project id.</summary>
    [JsonPropertyName("project")]
    public string? Project { get; set; }

    /// <summary>Strategies attached to the feature (or environment).</summary>
    [JsonPropertyName("strategies")]
    public List<UnleashStrategyDto>? Strategies { get; set; }

    /// <summary>Variants attached to the feature.</summary>
    [JsonPropertyName("variants")]
    public List<UnleashVariantDto>? Variants { get; set; }

    /// <summary>Per-environment payloads from Admin API style exports.</summary>
    [JsonPropertyName("environments")]
    public List<UnleashEnvironmentDto>? Environments { get; set; }
}

/// <summary>
/// Unleash environment slice on a feature (Admin API).
/// </summary>
public class UnleashEnvironmentDto
{
    /// <summary>Environment name.</summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>Whether the feature is enabled in this environment.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    /// <summary>Strategies for this environment.</summary>
    [JsonPropertyName("strategies")]
    public List<UnleashStrategyDto>? Strategies { get; set; }
}

/// <summary>
/// Unleash activation strategy.
/// </summary>
public class UnleashStrategyDto
{
    /// <summary>Strategy name (default, userWithId, flexibleRollout, …).</summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>Strategy parameters (rollout, userIds, stickiness, groupId, …).</summary>
    [JsonPropertyName("parameters")]
    public Dictionary<string, string>? Parameters { get; set; }

    /// <summary>Optional constraints evaluated against Unleash context.</summary>
    [JsonPropertyName("constraints")]
    public List<UnleashConstraintDto>? Constraints { get; set; }

    /// <summary>When true, Unleash ignores the strategy.</summary>
    [JsonPropertyName("disabled")]
    public bool Disabled { get; set; }
}

/// <summary>
/// Unleash strategy constraint.
/// </summary>
public class UnleashConstraintDto
{
    /// <summary>Context field name (userId, remoteAddress, custom, …).</summary>
    [JsonPropertyName("contextName")]
    public string ContextName { get; set; } = string.Empty;

    /// <summary>Constraint operator (IN, NOT_IN, STR_CONTAINS, SEMVER_GT, …).</summary>
    [JsonPropertyName("operator")]
    public string Operator { get; set; } = string.Empty;

    /// <summary>Multi-value set for set operators.</summary>
    [JsonPropertyName("values")]
    public List<string>? Values { get; set; }

    /// <summary>Single value for scalar operators.</summary>
    [JsonPropertyName("value")]
    public string? Value { get; set; }

    /// <summary>When true, invert the operator result.</summary>
    [JsonPropertyName("inverted")]
    public bool Inverted { get; set; }

    /// <summary>Case-insensitive string compare when supported by Unleash.</summary>
    [JsonPropertyName("caseInsensitive")]
    public bool CaseInsensitive { get; set; }
}

/// <summary>
/// Unleash feature variant.
/// </summary>
public class UnleashVariantDto
{
    /// <summary>Variant name.</summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>Weight (typically out of 1000).</summary>
    [JsonPropertyName("weight")]
    public int Weight { get; set; }

    /// <summary>Weight type (variable / fix).</summary>
    [JsonPropertyName("weightType")]
    public string? WeightType { get; set; }

    /// <summary>Whether the variant is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    /// <summary>Optional payload.</summary>
    [JsonPropertyName("payload")]
    public UnleashVariantPayloadDto? Payload { get; set; }

    /// <summary>Stickiness mode for variant assignment.</summary>
    [JsonPropertyName("stickiness")]
    public string? Stickiness { get; set; }
}

/// <summary>
/// Unleash variant payload (string / json / csv / …).
/// </summary>
public class UnleashVariantPayloadDto
{
    /// <summary>Payload type.</summary>
    [JsonPropertyName("type")]
    public string? Type { get; set; }

    /// <summary>Payload value.</summary>
    [JsonPropertyName("value")]
    public string? Value { get; set; }
}
