using System.ComponentModel.DataAnnotations;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Form fields for the editable feature metadata supported by the first dashboard release.</summary>
public sealed class DashboardFeatureInput
{
    public bool IsNew { get; set; }
    [Required, StringLength(128)]
    public string Key { get; set; } = string.Empty;

    [Required, StringLength(200)]
    public string Name { get; set; } = string.Empty;

    [StringLength(8000)]
    public string? Description { get; set; }

    public string? Tags { get; set; }

    public bool Enabled { get; set; }

    [Required]
    public string ExpectedRevision { get; set; } = string.Empty;

    public CatalogRequirementType RequirementType { get; set; } = CatalogRequirementType.Any;
    public string? ContextKind { get; set; }
    public CatalogRequirementType? ContextRequirementType { get; set; }
    public List<DashboardRuleInput> Rules { get; set; } = [];

    internal static DashboardFeatureInput FromFeature(CatalogFeature feature, string revision) => new()
    {
        IsNew = false,
        Key = feature.Key,
        Name = feature.Name,
        Description = feature.Description,
        Tags = string.Join(", ", feature.Tags),
        Enabled = feature.Enabled,
        ExpectedRevision = revision,
        RequirementType = feature.RequirementType,
        ContextKind = feature.ContextKind,
        ContextRequirementType = feature.ContextRequirementType,
        Rules = feature.Rules.Select(DashboardRuleInput.FromRule).ToList()
    };

    internal CatalogFeature ToFeature(CatalogFeature? existing = null) => new()
    {
        Key = Key.Trim(),
        Name = Name.Trim(),
        Description = Description?.Trim() ?? string.Empty,
        Tags = (Tags ?? string.Empty).Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).ToList(),
        Enabled = Enabled,
        RequirementType = RequirementType,
        ContextKind = ContextKind,
        ContextRequirementType = ContextRequirementType,
        Rules = Rules.Where(rule => !rule.IsBlank()).Select(rule => rule.ToRule()).ToList()
    };
}

/// <summary>A dashboard row for a built-in Toggly targeting filter.</summary>
public sealed class DashboardRuleInput
{
    public string Name { get; set; } = "Percentage";
    public string Values { get; set; } = string.Empty;
    public string Users { get; set; } = string.Empty;
    public string Groups { get; set; } = string.Empty;
    public string Percentage { get; set; } = "100";
    public string Start { get; set; } = string.Empty;
    public string End { get; set; } = string.Empty;
    public string Claim { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string ContextKind { get; set; } = string.Empty;
    public string Property { get; set; } = string.Empty;
    public string Operator { get; set; } = "eq";
    public string ValueType { get; set; } = "string";

    internal bool IsBlank() => Name == "Percentage" && Percentage == "100" && string.IsNullOrWhiteSpace(Values) && string.IsNullOrWhiteSpace(Users) && string.IsNullOrWhiteSpace(Groups) && string.IsNullOrWhiteSpace(Start) && string.IsNullOrWhiteSpace(End) && string.IsNullOrWhiteSpace(Claim) && string.IsNullOrWhiteSpace(Value) && string.IsNullOrWhiteSpace(ContextKind) && string.IsNullOrWhiteSpace(Property);

    internal CatalogRule ToRule()
    {
        var parameters = new Dictionary<string, string>(StringComparer.Ordinal);
        if (Name == "Percentage") parameters["Value"] = Percentage;
        else if (Name == "Targeting")
        {
            AddIndexed(parameters, "Audience.Users", Users);
            AddIndexed(parameters, "Audience.Groups", Groups);
            parameters["Audience.DefaultRolloutPercentage"] = Percentage;
            parameters["IgnoreCase"] = "true";
        }
        else if (Name == "TimeWindow")
        {
            if (!string.IsNullOrWhiteSpace(Start)) parameters["Start"] = Start;
            if (!string.IsNullOrWhiteSpace(End)) parameters["End"] = End;
        }
        else if (Name == "ContextProperty")
        {
            parameters["ContextKind"] = ContextKind;
            parameters["Property"] = Property;
            parameters["Operator"] = Operator;
            parameters["Value"] = Value;
            parameters["ValueType"] = ValueType;
        }
        else if (Name == "UserClaims")
        {
            parameters["Claim"] = Claim;
            parameters["Value"] = Value;
            parameters["Percentage"] = Percentage;
        }
        else
        {
            AddIndexed(parameters, Name == "BrowserFamily" ? "BrowserFamily" : Name == "BrowserLanguage" ? "BrowserLanguage" : Name == "OS" ? "OperatingSystem" : Name == "DeviceType" ? "DeviceType" : "Country", Values);
            parameters["Percentage"] = Percentage;
        }
        return new CatalogRule { Name = Name, Parameters = parameters };
    }

    internal static DashboardRuleInput FromRule(CatalogRule rule)
    {
        var input = new DashboardRuleInput { Name = rule.Name };
        input.Percentage = Get(rule, "Value", Get(rule, "Percentage", Get(rule, "Audience.DefaultRolloutPercentage", "100")));
        input.Users = Indexed(rule, "Audience.Users"); input.Groups = Indexed(rule, "Audience.Groups");
        input.Start = Get(rule, "Start", ""); input.End = Get(rule, "End", ""); input.Claim = Get(rule, "Claim", ""); input.Value = Get(rule, "Value", "");
        input.ContextKind = Get(rule, "ContextKind", ""); input.Property = Get(rule, "Property", ""); input.Operator = Get(rule, "Operator", "eq"); input.ValueType = Get(rule, "ValueType", "string");
        var prefix = rule.Name == "BrowserFamily" ? "BrowserFamily" : rule.Name == "BrowserLanguage" ? "BrowserLanguage" : rule.Name == "OS" ? "OperatingSystem" : rule.Name == "DeviceType" ? "DeviceType" : "Country";
        input.Values = Indexed(rule, prefix);
        return input;
    }

    private static string Get(CatalogRule rule, string key, string fallback) => rule.Parameters.TryGetValue(key, out var value) ? value : fallback;
    private static void AddIndexed(IDictionary<string, string> parameters, string prefix, string values)
    {
        foreach (var value in values.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Select((value, index) => new { value, index })) parameters[$"{prefix}:{value.index}"] = value.value;
    }
    private static string Indexed(CatalogRule rule, string prefix) => string.Join(", ", rule.Parameters.Where(pair => pair.Key.StartsWith(prefix + ":", StringComparison.Ordinal)).OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => pair.Value));
}

internal sealed class DashboardFeatureListViewModel
{
    internal required string Revision { get; init; }
    internal required IReadOnlyList<CatalogFeature> Features { get; init; }
    internal bool CatalogExists { get; init; }
    internal bool ReadOnly { get; init; }
    internal string Search { get; init; } = string.Empty;
    internal string State { get; init; } = string.Empty;
    internal string Tag { get; init; } = string.Empty;
    internal int Page { get; init; }
    internal IReadOnlyList<string> Tags { get; init; } = [];
}

internal sealed class DashboardContextsViewModel
{
    internal required IReadOnlyList<CatalogContextSchema> Registered { get; init; }
    internal required IReadOnlyList<CatalogContextSchema> Retained { get; init; }
}

internal sealed class DashboardImportPreviewViewModel
{
    internal required string Payload { get; init; }
    internal required string Fingerprint { get; init; }
    internal required string ExpectedRevision { get; init; }
    internal required IReadOnlyList<string> AddKeys { get; init; }
    internal required IReadOnlyList<string> IdenticalKeys { get; init; }
    internal required IReadOnlyList<string> ConflictKeys { get; init; }
}
