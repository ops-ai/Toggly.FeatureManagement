using System.Globalization;
using System.Text.Json;

namespace Toggly.FeatureManagement.Client;

/// <summary>
/// Soft-decodes resolved feature values from the evaluated-signed envelope
/// (<c>{ enabled, valueType?, value?, variant?, configurationValue? }</c>) by declared
/// <c>valueType</c> (<c>"boolean" | "string" | "number" | "json" | "datetime"</c>) (OPS-2102).
/// Never throws for a shape mismatch; never returns a wrong-typed value. Mirrors the decode
/// semantics of <c>toggly-eval</c>'s <c>feature-value-codec.ts</c> so every Toggly SDK agrees.
/// </summary>
internal static class FeatureValueCodec
{
    /// <summary>Returns whether a typed getter for <paramref name="requested"/> may attempt a decode.</summary>
    /// <remarks>Absent/empty <paramref name="declared"/> (legacy evaluated defs predating <c>valueType</c>) always allows the attempt; the decode itself still soft-nulls on failure.</remarks>
    internal static bool ValueTypeMatches(string? declared, string requested)
        => string.IsNullOrEmpty(declared) || declared == requested;

    internal static string? DecodeStringValue(JsonElement? raw, string? declared)
    {
        if (!ValueTypeMatches(declared, "string") || !raw.HasValue)
            return null;
        return raw.Value.ValueKind == JsonValueKind.String ? raw.Value.GetString() : null;
    }

    internal static double? DecodeNumberValue(JsonElement? raw, string? declared)
    {
        if (!ValueTypeMatches(declared, "number") || !raw.HasValue)
            return null;
        var element = raw.Value;
        if (element.ValueKind == JsonValueKind.Number && element.TryGetDouble(out var numberValue) && double.IsFinite(numberValue))
            return numberValue;
        if (element.ValueKind == JsonValueKind.String)
        {
            var text = element.GetString();
            if (!string.IsNullOrWhiteSpace(text)
                && double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
                && double.IsFinite(parsed))
                return parsed;
        }
        return null;
    }

    internal static JsonElement? DecodeJsonValue(JsonElement? raw, string? declared)
    {
        if (!ValueTypeMatches(declared, "json") || !raw.HasValue)
            return null;
        var element = raw.Value;
        if (element.ValueKind == JsonValueKind.Object || element.ValueKind == JsonValueKind.Array)
            return element.Clone();
        if (element.ValueKind == JsonValueKind.String)
        {
            var text = element.GetString();
            if (string.IsNullOrEmpty(text))
                return null;
            try
            {
                using var parsed = JsonDocument.Parse(text);
                if (parsed.RootElement.ValueKind == JsonValueKind.Object || parsed.RootElement.ValueKind == JsonValueKind.Array)
                    return parsed.RootElement.Clone();
            }
            catch (JsonException)
            {
                return null;
            }
        }
        return null;
    }

    /// <summary>ISO-8601 (or epoch-millisecond) wire value → <see cref="DateTimeOffset"/>; soft-null on failure.</summary>
    internal static DateTimeOffset? DecodeDateTimeValue(JsonElement? raw, string? declared)
    {
        if (!ValueTypeMatches(declared, "datetime") || !raw.HasValue)
            return null;
        var element = raw.Value;
        if (element.ValueKind == JsonValueKind.String)
        {
            var text = element.GetString();
            if (!string.IsNullOrWhiteSpace(text)
                && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed))
                return parsed;
            return null;
        }
        if (element.ValueKind == JsonValueKind.Number && element.TryGetDouble(out var epochMilliseconds) && double.IsFinite(epochMilliseconds))
        {
            try
            {
                return DateTimeOffset.FromUnixTimeMilliseconds((long)epochMilliseconds);
            }
            catch (ArgumentOutOfRangeException)
            {
                // Out-of-range numeric timestamp (outside DateTimeOffset's representable
                // range) — soft-null instead of throwing (OPS-2102 review finding).
                return null;
            }
        }
        return null;
    }

    /// <summary>
    /// Resolves the raw value and declared <c>valueType</c> from a cached definition envelope.
    /// Caller must already have verified the feature is enabled (including entity gates).
    /// Returns <c>null</c> for bare booleans or envelopes without a usable value payload.
    /// EntityGate objects may still carry <c>value</c>/<c>configurationValue</c> for typed getters.
    /// </summary>
    internal static (JsonElement Raw, string? ValueType)? ResolveEnvelope(JsonElement definition)
    {
        if (definition.ValueKind != JsonValueKind.Object)
            return null; // Bare boolean flags carry no typed value.

        // Pure EntityGate without value fields: nothing to decode.
        var hasValue = definition.TryGetProperty("value", out var valueProp);
        var hasConfigurationValue = definition.TryGetProperty("configurationValue", out var configurationValueProp);
        if (!hasValue && !hasConfigurationValue)
            return null;

        // Value envelopes use enabled:false to mean disabled. Entity gates omit enabled or set it false
        // until the client resolves the gate — caller already ran IsEnabled.
        if (definition.TryGetProperty("enabled", out var enabledProp)
            && enabledProp.ValueKind == JsonValueKind.False
            && !definition.TryGetProperty("rules", out _))
            return null;

        string? valueType = null;
        if (definition.TryGetProperty("valueType", out var valueTypeProp) && valueTypeProp.ValueKind == JsonValueKind.String)
            valueType = valueTypeProp.GetString();

        // Prefer "value"; fall back to "configurationValue" only when "value" is absent entirely.
        if (hasValue)
            return (valueProp, valueType);
        return (configurationValueProp, valueType);
    }
}
