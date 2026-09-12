using System.Globalization;
using System.Text.Json;

namespace Toggly.FeatureManagement.Client;

/// <summary>Evaluates signed entity gates against per-read local attributes.</summary>
public static class EntityEvaluator
{
    /// <summary>Resolves a boolean or entity rule without changing cached definitions.</summary>
    public static bool Resolve(JsonElement definition, EntityContext? entity = null)
    {
        if (definition.ValueKind == JsonValueKind.True)
            return true;
        if (definition.ValueKind != JsonValueKind.Object || entity is null)
            return false;
        if (!definition.TryGetProperty("rules", out var rules) || rules.ValueKind != JsonValueKind.Array || rules.GetArrayLength() == 0)
            return false;
        var requirement = ReadString(definition, "requirement", "all");
        if (requirement is not ("all" or "any"))
            return false;
        var values = rules.EnumerateArray().Select(rule => EvaluateRule(rule, entity.Attributes));
        return requirement == "any" ? values.Any(v => v) : values.All(v => v);
    }

    private static bool EvaluateRule(JsonElement rule, IReadOnlyDictionary<string, object?> attributes)
    {
        if (rule.ValueKind != JsonValueKind.Object)
            return false;
        var property = ReadString(rule, "property");
        var operation = ReadString(rule, "op")?.ToLowerInvariant();
        var expected = ReadString(rule, "value");
        if (property is null || operation is null || expected is null)
            return false;
        var key = attributes.Keys.FirstOrDefault(k => k == property)
            ?? attributes.Keys.FirstOrDefault(k => string.Equals(k, property, StringComparison.OrdinalIgnoreCase));
        if (key is null)
            return false;
        var actual = attributes[key];
        var text = Convert.ToString(actual, CultureInfo.InvariantCulture) ?? "";
        var type = ReadString(rule, "type", "string");
        return operation switch
        {
            "eq" => string.Equals(text, expected, StringComparison.OrdinalIgnoreCase),
            "neq" => !string.Equals(text, expected, StringComparison.OrdinalIgnoreCase),
            "in" => expected.Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).Contains(text, StringComparer.OrdinalIgnoreCase),
            "contains" => Contains(actual, text, expected, type),
            _ => Compare(text, expected, type, operation)
        };
    }

    private static string? ReadString(JsonElement element, string name, string? fallback = null)
    {
        if (!element.TryGetProperty(name, out var value))
            return fallback;
        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static bool Contains(object? actual, string text, string expected, string? type)
    {
        if (type == "string[]" && actual is IEnumerable<string> list)
            return list.Contains(expected, StringComparer.OrdinalIgnoreCase);
        return text.Contains(expected, StringComparison.OrdinalIgnoreCase);
    }

    private static bool Compare(string text, string expected, string? type, string operation)
    {
        double left, right;
        if (type == "datetime")
        {
            if (!DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var a) || !DateTimeOffset.TryParse(expected, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var b))
                return false;
            left = a.ToUnixTimeMilliseconds();
            right = b.ToUnixTimeMilliseconds();
        }
        else if (type != "number" || !double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out left) || !double.TryParse(expected, NumberStyles.Float, CultureInfo.InvariantCulture, out right) || !double.IsFinite(left) || !double.IsFinite(right))
            return false;
        return operation switch
        {
            "gt" => left > right,
            "gte" => left >= right,
            "lt" => left < right,
            "lte" => left <= right,
            _ => false
        };
    }
}
