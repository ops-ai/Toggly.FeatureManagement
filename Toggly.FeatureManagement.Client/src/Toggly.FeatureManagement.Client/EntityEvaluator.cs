using System.Globalization;
using System.Text.Json;
namespace Toggly.FeatureManagement.Client;

public static class EntityEvaluator
{
    public static bool Resolve(JsonElement definition, EntityContext? entity = null)
    {
        if (definition.ValueKind == JsonValueKind.True) return true;
        if (definition.ValueKind != JsonValueKind.Object || entity is null) return false;
        if (!definition.TryGetProperty("rules", out var rules) || rules.ValueKind != JsonValueKind.Array || rules.GetArrayLength() == 0) return false;
        var requirement = definition.TryGetProperty("requirement", out var req) ? (req.ValueKind==JsonValueKind.String?req.GetString():"invalid") : "all";
        if (requirement is not ("all" or "any")) return false;
        var values = rules.EnumerateArray().Select(rule => EvaluateRule(rule, entity.Attributes));
        return requirement == "any" ? values.Any(v => v) : values.All(v => v);
    }
    private static bool EvaluateRule(JsonElement rule, IReadOnlyDictionary<string,object?> attributes)
    {
        if (rule.ValueKind != JsonValueKind.Object || !rule.TryGetProperty("property", out var prop) || prop.ValueKind != JsonValueKind.String || !rule.TryGetProperty("op",out var op) || op.ValueKind != JsonValueKind.String || !rule.TryGetProperty("value",out var value) || value.ValueKind != JsonValueKind.String) return false;
        var key = attributes.Keys.FirstOrDefault(k => k == prop.GetString()) ?? attributes.Keys.FirstOrDefault(k => string.Equals(k,prop.GetString(),StringComparison.OrdinalIgnoreCase));
        if (key is null) return false;
        var actual = attributes[key]; var expected = value.GetString()!;
        var text = Convert.ToString(actual,CultureInfo.InvariantCulture) ?? "";
        var type = rule.TryGetProperty("type",out var t) ? (t.ValueKind==JsonValueKind.String?t.GetString():"invalid") : "string";
        var operation = op.GetString()!.ToLowerInvariant();
        if (operation == "eq") return string.Equals(text,expected,StringComparison.OrdinalIgnoreCase);
        if (operation == "neq") return !string.Equals(text,expected,StringComparison.OrdinalIgnoreCase);
        if (operation == "in") return expected.Split(',').Select(s=>s.Trim()).Where(s=>s.Length>0).Contains(text,StringComparer.OrdinalIgnoreCase);
        if (operation == "contains") return type == "string[]" && actual is IEnumerable<string> list ? list.Contains(expected,StringComparer.OrdinalIgnoreCase) : text.Contains(expected,StringComparison.OrdinalIgnoreCase);
        double left, right;
        if (type == "datetime")
        {
            if (!DateTimeOffset.TryParse(text,CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal,out var a) || !DateTimeOffset.TryParse(expected,CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal,out var b)) return false;
            left = a.ToUnixTimeMilliseconds(); right = b.ToUnixTimeMilliseconds();
        }
        else if (type != "number" || !double.TryParse(text,NumberStyles.Float,CultureInfo.InvariantCulture,out left) || !double.TryParse(expected,NumberStyles.Float,CultureInfo.InvariantCulture,out right) || !double.IsFinite(left) || !double.IsFinite(right)) return false;
        return operation switch { "gt" => left>right, "gte" => left>=right, "lt" => left<right, "lte" => left<=right, _ => false };
    }
}
