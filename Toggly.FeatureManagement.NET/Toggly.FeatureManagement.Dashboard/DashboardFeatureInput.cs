using System.ComponentModel.DataAnnotations;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Form fields for the editable feature metadata supported by the first dashboard release.</summary>
public sealed class DashboardFeatureInput
{
    [Required, StringLength(128)]
    public string Key { get; set; } = string.Empty;

    [Required, StringLength(200)]
    public string Name { get; set; } = string.Empty;

    [StringLength(8000)]
    public string Description { get; set; } = string.Empty;

    public string Tags { get; set; } = string.Empty;

    public bool Enabled { get; set; }

    [Required]
    public string ExpectedRevision { get; set; } = string.Empty;

    internal static DashboardFeatureInput FromFeature(CatalogFeature feature, string revision) => new()
    {
        Key = feature.Key,
        Name = feature.Name,
        Description = feature.Description,
        Tags = string.Join(", ", feature.Tags),
        Enabled = feature.Enabled,
        ExpectedRevision = revision
    };

    internal CatalogFeature ToFeature(CatalogFeature? existing = null) => new()
    {
        Key = Key.Trim(),
        Name = Name.Trim(),
        Description = Description.Trim(),
        Tags = Tags.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).ToList(),
        Enabled = Enabled,
        RequirementType = existing?.RequirementType ?? CatalogRequirementType.Any,
        ContextKind = existing?.ContextKind,
        ContextRequirementType = existing?.ContextRequirementType,
        Rules = existing?.Rules.Select(rule => new CatalogRule { Name = rule.Name, Parameters = new Dictionary<string, string>(rule.Parameters, StringComparer.Ordinal) }).ToList() ?? []
    };
}

internal sealed class DashboardFeatureListViewModel
{
    internal required string Revision { get; init; }
    internal required IReadOnlyList<CatalogFeature> Features { get; init; }
    internal bool CatalogExists { get; init; }
    internal bool ReadOnly { get; init; }
}
