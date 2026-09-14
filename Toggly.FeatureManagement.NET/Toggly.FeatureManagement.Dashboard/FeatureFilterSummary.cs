using System.Globalization;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>SaaS-style collapsed-card copy for persisted targeting filters.</summary>
internal static class FeatureFilterSummary
{
    public static bool IsConditional(CatalogFeature feature) =>
        feature.Enabled && feature.Rules.Any(rule => !string.Equals(rule.Name, "AlwaysOn", StringComparison.Ordinal));

    public static IReadOnlyList<string> Lines(CatalogFeature feature, IReadOnlyList<CatalogList> lists) =>
        feature.Rules
            .Where(rule => !string.Equals(rule.Name, "AlwaysOn", StringComparison.Ordinal))
            .Select(rule => Line(rule, lists))
            .Where(line => line.Length > 0)
            .ToList();

    private static string Line(CatalogRule rule, IReadOnlyList<CatalogList> lists) => rule.Name switch
    {
        "Percentage" => ForPercentage(Get(rule, "Value")),
        "Targeting" => Targeting(rule, lists),
        "TimeWindow" => TimeWindow(rule),
        "ContextProperty" => ContextProperty(rule),
        "UserClaims" => Join(
            ForString(Get(rule, "Claim"), "Claim"),
            ForString(Get(rule, "Value"), "Value"),
            string.IsNullOrEmpty(Get(rule, "Percentage")) ? "" : ForPercentage(Get(rule, "Percentage"))),
        "BrowserFamily" => ForIndexed(rule, "BrowserFamily", "browsers"),
        "BrowserLanguage" => ForIndexed(rule, "BrowserLanguage", "languages"),
        "OS" => ForIndexed(rule, "OperatingSystem", "operating systems"),
        "DeviceType" => ForIndexed(rule, "DeviceType", "devices"),
        "CountryFamily" => ForIndexed(rule, "Country", "countries"),
        _ => DashboardRuleInput.SupportedNames.GetValueOrDefault(rule.Name, rule.Name)
    };

    private static string Targeting(CatalogRule rule, IReadOnlyList<CatalogList> lists) => Join(
        ForList(rule, lists, "Audience.Users", "Users"),
        ForList(rule, lists, "Audience.Groups", "Groups"),
        ForList(rule, lists, "Audience.Exclusion.Users", "Excluded users"),
        ForList(rule, lists, "Audience.Exclusion.Groups", "Excluded groups"));

    private static string TimeWindow(CatalogRule rule) => Join(
        ForDate(Get(rule, "Start"), "Start"),
        ForDate(Get(rule, "End"), "End"));

    private static string ContextProperty(CatalogRule rule)
    {
        var kind = Get(rule, "ContextKind");
        var property = Get(rule, "Property");
        var op = Get(rule, "Operator");
        var value = Get(rule, "Value");
        var valueType = Get(rule, "ValueType");
        if (kind.Length == 0 && property.Length == 0) return "";
        var subject = kind.Length == 0 ? "Entity" : kind;
        return $"{subject} where {property} {OperatorLabel(op, valueType)} {FormatRuleValue(value, valueType, op)}";
    }

    private static string ForList(CatalogRule rule, IReadOnlyList<CatalogList> lists, string key, string slot)
    {
        var listKey = Get(rule, key);
        if (listKey.Length == 0) return "";
        var list = lists.FirstOrDefault(candidate => string.Equals(candidate.Key, listKey, StringComparison.OrdinalIgnoreCase));
        return $"for {(list?.Name.Length > 0 ? list.Name : listKey)} ({slot})";
    }

    private static string ForIndexed(CatalogRule rule, string prefix, string friendly)
    {
        var values = rule.Parameters
            .Where(pair => pair.Key.StartsWith(prefix + ":", StringComparison.Ordinal))
            .OrderBy(pair => int.Parse(pair.Key[(prefix.Length + 1)..], CultureInfo.InvariantCulture))
            .Select(pair => pair.Value)
            .Where(value => value.Length > 0)
            .ToArray();
        return values.Length == 0 ? "" : $"for the following {friendly}: {string.Join(", ", values)}";
    }

    private static string ForPercentage(string value) => value.Length == 0 ? "" : $"for {value}% of users";
    private static string ForString(string value, string friendly) => value.Length == 0 ? "" : $"for {value} ({friendly})";
    private static string ForDate(string value, string friendly)
    {
        if (value.Length == 0) return "";
        return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed)
            ? $"{friendly} {parsed.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)}"
            : $"{friendly} {value}";
    }

    private static string OperatorLabel(string op, string valueType)
    {
        var datetime = string.Equals(valueType, "datetime", StringComparison.OrdinalIgnoreCase);
        return op switch
        {
            "eq" => "is",
            "neq" => "is not",
            "gt" => datetime ? "is after" : "is greater than",
            "gte" => datetime ? "is on or after" : "is greater than or equal to",
            "lt" => datetime ? "is before" : "is less than",
            "lte" => datetime ? "is on or before" : "is less than or equal to",
            "in" => "is one of",
            "contains" => "contains",
            _ => op
        };
    }

    private static string FormatRuleValue(string value, string valueType, string op)
    {
        if (string.Equals(op, "in", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(valueType, "datetime", StringComparison.OrdinalIgnoreCase))
            return value;
        return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed)
            ? parsed.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : value;
    }

    private static string Get(CatalogRule rule, string key) =>
        rule.Parameters.TryGetValue(key, out var value) && value != null ? value : "";

    private static string Join(params string[] parts) =>
        string.Join(", ", parts.Where(part => part.Length > 0));
}
