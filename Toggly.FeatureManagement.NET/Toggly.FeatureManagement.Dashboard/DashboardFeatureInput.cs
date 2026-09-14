using System.ComponentModel.DataAnnotations;
using System.Text;
using System.Text.RegularExpressions;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Form fields for the editable feature metadata supported by the first dashboard release.</summary>
public sealed class DashboardFeatureInput
{
    [Required]
    public required bool IsNew { get; set; }
    [Required, StringLength(128)]
    public string Key { get; set; } = string.Empty;

    [Required, StringLength(200)]
    public string Name { get; set; } = string.Empty;

    [StringLength(8000)]
    public string? Description { get; set; }

    [TrimmedStringLength(200)]
    public string? Category { get; set; }

    public string? Tags { get; set; }

    public bool? Enabled { get; set; }

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
        Category = feature.Category,
        Tags = string.Join("\n", feature.Tags),
        Enabled = feature.Enabled,
        ExpectedRevision = revision,
        RequirementType = feature.RequirementType,
        ContextKind = feature.ContextKind,
        ContextRequirementType = feature.ContextRequirementType,
        Rules = feature.Rules.Select(DashboardRuleInput.FromRule).ToList()
    };

    internal CatalogFeature ToNewFeature() => new()
    {
        Key = Key.Trim(),
        Name = Name.Trim(),
        Description = Description?.Trim() ?? string.Empty,
        Category = Category?.Trim() ?? string.Empty,
        Tags = SplitTags(),
        Enabled = false,
        RequirementType = CatalogRequirementType.Any,
        ContextKind = string.IsNullOrWhiteSpace(ContextKind) ? null : ContextKind,
        ContextRequirementType = ContextRequirementType,
        Rules = []
    };

    internal void ApplyMetadata(CatalogFeature existing)
    {
        existing.Name = Name.Trim();
        existing.Description = Description?.Trim() ?? string.Empty;
        existing.Category = Category?.Trim() ?? string.Empty;
        existing.Tags = SplitTags();
        var previousKind = existing.ContextKind;
        existing.ContextKind = string.IsNullOrWhiteSpace(ContextKind) ? null : ContextKind.Trim();
        if (!string.Equals(previousKind, existing.ContextKind, StringComparison.OrdinalIgnoreCase))
            existing.Rules.RemoveAll(rule => string.Equals(rule.Name, DashboardRuleInput.ContextProperty, StringComparison.Ordinal));
    }

    internal void ApplyConditions(CatalogFeature existing)
    {
        existing.Enabled = Enabled.GetValueOrDefault();
        existing.RequirementType = RequirementType;
        existing.ContextRequirementType = ContextRequirementType;
        if (!existing.Enabled)
        {
            existing.Rules = [];
            return;
        }

        existing.Rules = Rules.Select(rule => rule.ToRule()).ToList();
    }

    private List<string> SplitTags() =>
        (Tags ?? string.Empty).Split(['\r', '\n'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).ToList();
}

[AttributeUsage(AttributeTargets.Property)]
internal sealed class TrimmedStringLengthAttribute(int maximumLength) : StringLengthAttribute(maximumLength)
{
    public override bool IsValid(object? value) => value is not string text || base.IsValid(text.Trim());
}

/// <summary>A dashboard row for a built-in Toggly targeting filter.</summary>
public sealed class DashboardRuleInput
{
    internal const string AlwaysOn = "AlwaysOn";
    internal const string FilterPercentage = "Percentage";
    internal const string Targeting = "Targeting";
    internal const string TimeWindow = "TimeWindow";
    internal const string ContextProperty = "ContextProperty";
    internal const string BrowserFamily = "BrowserFamily";
    internal const string BrowserLanguage = "BrowserLanguage";
    internal const string DeviceType = "DeviceType";
    internal const string UserClaims = "UserClaims";
    internal const string OperatingSystem = "OS";
    internal const string CountryFamily = "CountryFamily";
    internal const string ParamValue = "Value";

    internal static IReadOnlyDictionary<string, string> SupportedNames { get; } = new Dictionary<string, string>
    {
        [AlwaysOn] = "Always On", [FilterPercentage] = "Percentage", [Targeting] = "Users/groups", [TimeWindow] = "Schedule",
        [ContextProperty] = "Entity property", [BrowserFamily] = "Browser", [BrowserLanguage] = "Language",
        [OperatingSystem] = "Operating system", [DeviceType] = "Device", [CountryFamily] = "Country", [UserClaims] = "Claim"
    };

    internal static IReadOnlyDictionary<string, string> UserFilterNames { get; } = SupportedNames
        .Where(pair => pair.Key != ContextProperty)
        .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);

    public string Name { get; set; } = FilterPercentage;
    public string? Values { get; set; } = string.Empty;
    public string? Users { get; set; } = string.Empty;
    public string? Groups { get; set; } = string.Empty;
    public string? ExclusionUsers { get; set; } = string.Empty;
    public string? ExclusionGroups { get; set; } = string.Empty;
    public bool IgnoreCase { get; set; } = true;
    public string Percentage { get; set; } = "100";
    public string? Start { get; set; } = string.Empty;
    public string? End { get; set; } = string.Empty;
    public string? Claim { get; set; } = string.Empty;
    public string? Value { get; set; } = string.Empty;
    public string? ContextKind { get; set; } = string.Empty;
    public string? Property { get; set; } = string.Empty;
    public string Operator { get; set; } = "eq";
    public string ValueType { get; set; } = "string";

    internal CatalogRule ToRule()
    {
        var parameters = new Dictionary<string, string>(StringComparer.Ordinal);
        if (Name == FilterPercentage) parameters[ParamValue] = Percentage;
        else if (Name == Targeting) AddTargeting(parameters);
        else if (Name == TimeWindow) AddTimeWindow(parameters);
        else if (Name == ContextProperty) AddContextProperty(parameters);
        else if (Name == UserClaims)
        {
            parameters["Claim"] = Claim ?? string.Empty;
            parameters[ParamValue] = Value ?? string.Empty;
            parameters[FilterPercentage] = Percentage;
        }
        else if (Name != AlwaysOn)
        {
            AddIndexed(parameters, IndexedPrefix(Name), Values);
            parameters[FilterPercentage] = Percentage;
        }
        return new CatalogRule { Name = Name, Parameters = parameters };
    }

    private void AddTargeting(Dictionary<string, string> parameters)
    {
        AddListKey(parameters, "Audience.Users", Users);
        AddListKey(parameters, "Audience.Groups", Groups);
        AddListKey(parameters, "Audience.Exclusion.Users", ExclusionUsers);
        AddListKey(parameters, "Audience.Exclusion.Groups", ExclusionGroups);
        parameters["Audience.DefaultRolloutPercentage"] = Percentage;
        parameters["IgnoreCase"] = IgnoreCase ? "true" : "false";
    }

    private void AddTimeWindow(Dictionary<string, string> parameters)
    {
        if (!string.IsNullOrWhiteSpace(Start)) parameters["Start"] = Start;
        if (!string.IsNullOrWhiteSpace(End)) parameters["End"] = End;
    }

    private void AddContextProperty(Dictionary<string, string> parameters)
    {
        parameters["ContextKind"] = ContextKind ?? string.Empty;
        parameters["Property"] = Property ?? string.Empty;
        parameters["Operator"] = Operator;
        parameters[ParamValue] = Value ?? string.Empty;
        parameters["ValueType"] = ValueType;
    }

    internal static DashboardRuleInput FromRule(CatalogRule rule)
    {
        var input = new DashboardRuleInput { Name = rule.Name };
        input.Percentage = PercentageValue(rule);
        input.Users = Get(rule, "Audience.Users", ""); input.Groups = Get(rule, "Audience.Groups", "");
        input.ExclusionUsers = Get(rule, "Audience.Exclusion.Users", ""); input.ExclusionGroups = Get(rule, "Audience.Exclusion.Groups", "");
        input.IgnoreCase = !string.Equals(Get(rule, "IgnoreCase", "true"), "false", StringComparison.OrdinalIgnoreCase);
        input.Start = Get(rule, "Start", ""); input.End = Get(rule, "End", ""); input.Claim = Get(rule, "Claim", ""); input.Value = Get(rule, ParamValue, "");
        input.ContextKind = Get(rule, "ContextKind", ""); input.Property = Get(rule, "Property", ""); input.Operator = Get(rule, "Operator", "eq"); input.ValueType = Get(rule, "ValueType", "string");
        input.Values = Indexed(rule, IndexedPrefix(rule.Name));
        return input;
    }

    private static string PercentageValue(CatalogRule rule)
    {
        if (rule.Name == FilterPercentage) return Get(rule, ParamValue, "100");
        if (rule.Name == Targeting) return Get(rule, "Audience.DefaultRolloutPercentage", "0");
        return Get(rule, FilterPercentage, "100");
    }

    internal static bool IsEntityRule(string name) => string.Equals(name, ContextProperty, StringComparison.Ordinal);

    private static string IndexedPrefix(string name)
    {
        if (name == BrowserFamily) return BrowserFamily;
        if (name == BrowserLanguage) return BrowserLanguage;
        if (name == OperatingSystem) return "OperatingSystem";
        if (name == DeviceType) return DeviceType;
        return "Country";
    }

    private static string Get(CatalogRule rule, string key, string fallback) => rule.Parameters.TryGetValue(key, out var value) ? value : fallback;
    private static void AddListKey(Dictionary<string, string> parameters, string key, string? listKey)
    {
        if (!string.IsNullOrWhiteSpace(listKey)) parameters[key] = listKey.Trim();
    }
    private static void AddIndexed(Dictionary<string, string> parameters, string prefix, string? values)
    {
        foreach (var value in (values ?? string.Empty).Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).Select((value, index) => new { value, index })) parameters[$"{prefix}:{value.index}"] = value.value;
    }
    private static string Indexed(CatalogRule rule, string prefix) => string.Join("\n", rule.Parameters.Where(pair => pair.Key.StartsWith(prefix + ":", StringComparison.Ordinal)).OrderBy(pair => int.Parse(pair.Key[(prefix.Length + 1)..], System.Globalization.CultureInfo.InvariantCulture)).Select(pair => pair.Value));
}

internal static partial class FeatureFlagsEnum
{
    [GeneratedRegex("^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 250)]
    private static partial Regex ValidMember();

    internal static string Generate(IEnumerable<CatalogFeature> features)
    {
        var used = new HashSet<string>(StringComparer.Ordinal);
        var members = new List<string>();
        foreach (var key in features.Select(feature => feature.Key).OrderBy(key => key, StringComparer.Ordinal))
        {
            var stem = Sanitize(key);
            var member = stem;
            var suffix = 2;
            while (!used.Add(member))
            {
                member = stem + "__" + suffix.ToString(System.Globalization.CultureInfo.InvariantCulture);
                suffix++;
            }
            members.Add(member);
        }

        var builder = new StringBuilder();
        builder.AppendLine("public enum FeatureFlags");
        builder.AppendLine("{");
        for (var index = 0; index < members.Count; index++)
        {
            builder.Append("    ");
            builder.Append(members[index]);
            builder.AppendLine(index == members.Count - 1 ? "" : ",");
        }
        builder.Append('}');
        return builder.ToString();
    }

    internal static string Sanitize(string key)
    {
        if (ValidMember().IsMatch(key)) return key;
        var sanitized = key.Replace('.', '_').Replace(':', '_').Replace('-', '_');
        if (sanitized.Length == 0 || char.IsDigit(sanitized[0])) sanitized = "_" + sanitized;
        return sanitized;
    }
}

internal sealed class DashboardFeatureListViewModel
{
    internal required string Revision { get; init; }
    internal required IReadOnlyList<CatalogFeature> Features { get; init; }
    internal required IReadOnlyList<CatalogFeature> AllFeatures { get; init; }
    internal bool CatalogExists { get; init; }
    internal bool ReadOnly { get; init; }
    internal string Search { get; init; } = string.Empty;
    internal string Category { get; init; } = string.Empty;
    internal string Tag { get; init; } = string.Empty;
    internal string Sort { get; init; } = "az";
    internal string Expand { get; init; } = string.Empty;
    internal IReadOnlyList<string> Tags { get; init; } = [];
    internal IReadOnlyList<string> Categories { get; init; } = [];
    internal int UncategorizedCount { get; init; }
    internal string CopyCSharp { get; init; } = string.Empty;
    internal DashboardFeatureInput? ConditionsDraft { get; init; }
    internal IReadOnlyList<CatalogList> Lists { get; init; } = [];
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
    internal required string? ExpectedRevision { get; init; }
    internal required IReadOnlyList<string> AddKeys { get; init; }
    internal required IReadOnlyList<string> IdenticalKeys { get; init; }
    internal required IReadOnlyList<string> ConflictKeys { get; init; }
    internal required IReadOnlyList<string> ContextConflictKinds { get; init; }
}

internal sealed class DashboardListsViewModel
{
    internal required string Revision { get; init; }
    internal required IReadOnlyList<CatalogList> Lists { get; init; }
    internal required IReadOnlyDictionary<string, int> Usage { get; init; }
    internal bool ReadOnly { get; init; }
    internal string? BlockedKey { get; init; }
}

public sealed class DashboardFeatureListFilter
{
    public string? Search { get; set; }
    public string? Tag { get; set; }
    public string? Category { get; set; }
    public string? Sort { get; set; }
}

/// <summary>Form fields for a reusable catalog identifier list.</summary>
public sealed class DashboardListInput
{
    [Required]
    public required bool IsNew { get; set; }
    [Required, StringLength(128)]
    public string Key { get; set; } = string.Empty;
    [Required, StringLength(200)]
    public string Name { get; set; } = string.Empty;
    [StringLength(8000)]
    public string? Description { get; set; }
    public string? Items { get; set; }
    [Required]
    public string ExpectedRevision { get; set; } = string.Empty;

    internal static DashboardListInput FromList(CatalogList list, string revision) => new()
    {
        IsNew = false,
        Key = list.Key,
        Name = list.Name,
        Description = list.Description,
        Items = string.Join("\n", list.Items),
        ExpectedRevision = revision
    };

    internal CatalogList ToList() => new()
    {
        Key = Key.Trim(),
        Name = Name.Trim(),
        Description = Description?.Trim() ?? string.Empty,
        Items = SplitItems()
    };

    internal void Apply(CatalogList existing)
    {
        existing.Name = Name.Trim();
        existing.Description = Description?.Trim() ?? string.Empty;
        existing.Items = SplitItems();
    }

    private List<string> SplitItems() =>
        (Items ?? string.Empty).Split(['\r', '\n'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).ToList();
}
