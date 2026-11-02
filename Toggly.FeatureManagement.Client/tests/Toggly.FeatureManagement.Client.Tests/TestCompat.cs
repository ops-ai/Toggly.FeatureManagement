using System.Text.Json;
using System.Text.Json.Nodes;

namespace ClientTests;

internal static class TestCompat
{
    public static bool JsonDeepEquals(JsonNode? left, JsonNode? right)
    {
#if NET8_0_OR_GREATER
        return JsonNode.DeepEquals(left, right);
#else
        return Canonical(left) == Canonical(right);
#endif
    }

    static string Canonical(JsonNode? node)
    {
        if (node is null)
            return "null";
        using var doc = JsonDocument.Parse(node.ToJsonString());
        return CanonicalElement(doc.RootElement);
    }

    static string CanonicalElement(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => "{" + string.Join(",", element.EnumerateObject()
            .OrderBy(p => p.Name, StringComparer.Ordinal)
            .Select(p => JsonSerializer.Serialize(p.Name) + ":" + CanonicalElement(p.Value))) + "}",
        JsonValueKind.Array => "[" + string.Join(",", element.EnumerateArray().Select(CanonicalElement)) + "]",
        JsonValueKind.String => JsonSerializer.Serialize(element.GetString()),
        JsonValueKind.Number => element.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "null",
        _ => element.GetRawText()
    };
}
