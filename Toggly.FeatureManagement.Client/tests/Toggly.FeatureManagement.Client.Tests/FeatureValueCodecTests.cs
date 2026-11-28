using System.Text.Json;
using Toggly.FeatureManagement.Client;
using Xunit;

namespace ClientTests;

/// <summary>
/// Direct unit coverage for <see cref="FeatureValueCodec"/>'s soft-decode semantics
/// (OPS-2102): never throw for shape alone, never return a wrong-typed value.
/// </summary>
public class FeatureValueCodecTests
{
    [Fact]
    public void DecodeDateTimeValueSoftNullsOutOfRangeNumericTimestamp()
    {
        // double.MaxValue is finite but far outside DateTimeOffset's representable
        // range; FromUnixTimeMilliseconds would throw ArgumentOutOfRangeException.
        using var doc = JsonDocument.Parse(double.MaxValue.ToString("R"));
        var result = FeatureValueCodec.DecodeDateTimeValue(doc.RootElement, "datetime");
        Assert.Null(result);
    }

    [Fact]
    public void DecodeDateTimeValueSoftNullsLargeOutOfRangeIntegerTimestamp()
    {
        // Comfortably outside the representable millisecond range in either direction.
        using var doc = JsonDocument.Parse("99999999999999999999");
        var result = FeatureValueCodec.DecodeDateTimeValue(doc.RootElement, "datetime");
        Assert.Null(result);
    }

    [Fact]
    public void DecodeDateTimeValueDecodesInRangeEpochMilliseconds()
    {
        using var doc = JsonDocument.Parse("1770000000000");
        var result = FeatureValueCodec.DecodeDateTimeValue(doc.RootElement, "datetime");
        Assert.Equal(DateTimeOffset.FromUnixTimeMilliseconds(1770000000000), result);
    }

    [Fact]
    public void DecodeDateTimeValueSoftNullsOnDeclaredTypeMismatch()
    {
        using var doc = JsonDocument.Parse("\"2026-02-03T04:05:06Z\"");
        Assert.Null(FeatureValueCodec.DecodeDateTimeValue(doc.RootElement, "string"));
    }

    [Fact]
    public void DecodeDateTimeValueSoftNullsWhenRawAbsent()
    {
        Assert.Null(FeatureValueCodec.DecodeDateTimeValue(null, "datetime"));
    }

    [Fact]
    public void DecodeDateTimeValueSoftNullsOnUnparsableString()
    {
        using var doc = JsonDocument.Parse("\"not-a-date\"");
        Assert.Null(FeatureValueCodec.DecodeDateTimeValue(doc.RootElement, "datetime"));
    }

    [Fact]
    public void DecodeDateTimeValueSoftNullsOnBlankString()
    {
        using var doc = JsonDocument.Parse("\"   \"");
        Assert.Null(FeatureValueCodec.DecodeDateTimeValue(doc.RootElement, "datetime"));
    }

    [Fact]
    public void DecodeDateTimeValueSoftNullsOnNonStringNonNumberKind()
    {
        using var doc = JsonDocument.Parse("true");
        Assert.Null(FeatureValueCodec.DecodeDateTimeValue(doc.RootElement, "datetime"));
    }

    [Theory]
    [InlineData(null, "string", true)]
    [InlineData("", "number", true)]
    [InlineData("string", "string", true)]
    [InlineData("number", "string", false)]
    public void ValueTypeMatchesHonorsDeclaredType(string? declared, string requested, bool expected)
    {
        Assert.Equal(expected, FeatureValueCodec.ValueTypeMatches(declared, requested));
    }

    [Fact]
    public void DecodeStringValueReturnsStringForMatchingKind()
    {
        using var doc = JsonDocument.Parse("\"hello\"");
        Assert.Equal("hello", FeatureValueCodec.DecodeStringValue(doc.RootElement, "string"));
        // Legacy evaluated defs predating valueType: absent declared type still allows the attempt.
        Assert.Equal("hello", FeatureValueCodec.DecodeStringValue(doc.RootElement, null));
    }

    [Fact]
    public void DecodeStringValueSoftNullsOnDeclaredTypeMismatch()
    {
        using var doc = JsonDocument.Parse("\"hello\"");
        Assert.Null(FeatureValueCodec.DecodeStringValue(doc.RootElement, "number"));
    }

    [Fact]
    public void DecodeStringValueSoftNullsWhenRawAbsent()
    {
        Assert.Null(FeatureValueCodec.DecodeStringValue(null, "string"));
    }

    [Fact]
    public void DecodeStringValueSoftNullsOnNonStringKind()
    {
        using var doc = JsonDocument.Parse("42");
        Assert.Null(FeatureValueCodec.DecodeStringValue(doc.RootElement, "string"));
    }

    [Fact]
    public void DecodeNumberValueDecodesNumericKind()
    {
        using var doc = JsonDocument.Parse("3.5");
        Assert.Equal(3.5, FeatureValueCodec.DecodeNumberValue(doc.RootElement, "number"));
    }

    [Fact]
    public void DecodeNumberValueParsesNumericStringFallback()
    {
        using var doc = JsonDocument.Parse("\"42.5\"");
        Assert.Equal(42.5, FeatureValueCodec.DecodeNumberValue(doc.RootElement, "number"));
    }

    [Fact]
    public void DecodeNumberValueSoftNullsOnNonNumericString()
    {
        using var doc = JsonDocument.Parse("\"not-a-number\"");
        Assert.Null(FeatureValueCodec.DecodeNumberValue(doc.RootElement, "number"));
    }

    [Fact]
    public void DecodeNumberValueSoftNullsOnBlankString()
    {
        using var doc = JsonDocument.Parse("\"   \"");
        Assert.Null(FeatureValueCodec.DecodeNumberValue(doc.RootElement, "number"));
    }

    [Fact]
    public void DecodeNumberValueSoftNullsOnDeclaredTypeMismatch()
    {
        using var doc = JsonDocument.Parse("3.5");
        Assert.Null(FeatureValueCodec.DecodeNumberValue(doc.RootElement, "string"));
    }

    [Fact]
    public void DecodeNumberValueSoftNullsWhenRawAbsent()
    {
        Assert.Null(FeatureValueCodec.DecodeNumberValue(null, "number"));
    }

    [Fact]
    public void DecodeNumberValueSoftNullsOnNonNumericNonStringKind()
    {
        using var doc = JsonDocument.Parse("true");
        Assert.Null(FeatureValueCodec.DecodeNumberValue(doc.RootElement, "number"));
    }

    [Fact]
    public void DecodeJsonValueClonesObjectKind()
    {
        using var doc = JsonDocument.Parse("{\"a\":1}");
        var result = FeatureValueCodec.DecodeJsonValue(doc.RootElement, "json");
        Assert.NotNull(result);
        Assert.Equal(1, result!.Value.GetProperty("a").GetInt32());
    }

    [Fact]
    public void DecodeJsonValueClonesArrayKind()
    {
        using var doc = JsonDocument.Parse("[1,2,3]");
        var result = FeatureValueCodec.DecodeJsonValue(doc.RootElement, "json");
        Assert.NotNull(result);
        Assert.Equal(JsonValueKind.Array, result!.Value.ValueKind);
    }

    [Fact]
    public void DecodeJsonValueParsesEncodedObjectString()
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize("{\"a\":1}"));
        var result = FeatureValueCodec.DecodeJsonValue(doc.RootElement, "json");
        Assert.NotNull(result);
        Assert.Equal(1, result!.Value.GetProperty("a").GetInt32());
    }

    [Fact]
    public void DecodeJsonValueParsesEncodedArrayString()
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize("[1,2]"));
        var result = FeatureValueCodec.DecodeJsonValue(doc.RootElement, "json");
        Assert.NotNull(result);
        Assert.Equal(JsonValueKind.Array, result!.Value.ValueKind);
    }

    [Fact]
    public void DecodeJsonValueSoftNullsOnInvalidEncodedString()
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize("not-json{"));
        Assert.Null(FeatureValueCodec.DecodeJsonValue(doc.RootElement, "json"));
    }

    [Fact]
    public void DecodeJsonValueSoftNullsOnEmptyEncodedString()
    {
        using var doc = JsonDocument.Parse("\"\"");
        Assert.Null(FeatureValueCodec.DecodeJsonValue(doc.RootElement, "json"));
    }

    [Fact]
    public void DecodeJsonValueSoftNullsOnEncodedScalarString()
    {
        // Parses as valid JSON, but the root is a scalar, not an object/array.
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize("42"));
        Assert.Null(FeatureValueCodec.DecodeJsonValue(doc.RootElement, "json"));
    }

    [Fact]
    public void DecodeJsonValueSoftNullsOnDeclaredTypeMismatch()
    {
        using var doc = JsonDocument.Parse("{\"a\":1}");
        Assert.Null(FeatureValueCodec.DecodeJsonValue(doc.RootElement, "string"));
    }

    [Fact]
    public void DecodeJsonValueSoftNullsWhenRawAbsent()
    {
        Assert.Null(FeatureValueCodec.DecodeJsonValue(null, "json"));
    }

    [Fact]
    public void DecodeJsonValueSoftNullsOnBareScalarKind()
    {
        using var doc = JsonDocument.Parse("42");
        Assert.Null(FeatureValueCodec.DecodeJsonValue(doc.RootElement, "json"));
    }

    [Fact]
    public void ResolveEnvelopeReturnsNullForBareBoolean()
    {
        using var doc = JsonDocument.Parse("true");
        Assert.Null(FeatureValueCodec.ResolveEnvelope(doc.RootElement));
    }

    [Fact]
    public void ResolveEnvelopeReturnsNullForPureEntityGateWithoutValueFields()
    {
        using var doc = JsonDocument.Parse("{\"requirement\":\"all\",\"rules\":[]}");
        Assert.Null(FeatureValueCodec.ResolveEnvelope(doc.RootElement));
    }

    [Fact]
    public void ResolveEnvelopeReturnsNullForDisabledValueEnvelopeWithoutRules()
    {
        using var doc = JsonDocument.Parse("{\"enabled\":false,\"valueType\":\"string\",\"value\":\"unused\"}");
        Assert.Null(FeatureValueCodec.ResolveEnvelope(doc.RootElement));
    }

    [Fact]
    public void ResolveEnvelopeKeepsValueForHybridEntityGateCarryingDisabledFlag()
    {
        // Entity gates don't use "enabled" meaningfully; "rules" presence takes precedence
        // over a stale/legacy "enabled":false so typed getters can still decode the value.
        using var doc = JsonDocument.Parse(
            "{\"enabled\":false,\"valueType\":\"string\",\"value\":\"entity-value\",\"requirement\":\"all\",\"rules\":[]}");
        var result = FeatureValueCodec.ResolveEnvelope(doc.RootElement);
        Assert.NotNull(result);
        Assert.Equal("entity-value", result!.Value.Raw.GetString());
        Assert.Equal("string", result.Value.ValueType);
    }

    [Fact]
    public void ResolveEnvelopeSucceedsWhenEnabledFieldIsAbsent()
    {
        using var doc = JsonDocument.Parse("{\"value\":\"x\"}");
        var result = FeatureValueCodec.ResolveEnvelope(doc.RootElement);
        Assert.NotNull(result);
        Assert.Equal("x", result!.Value.Raw.GetString());
    }

    [Fact]
    public void ResolveEnvelopePrefersValueOverConfigurationValue()
    {
        using var doc = JsonDocument.Parse("{\"enabled\":true,\"value\":\"primary\",\"configurationValue\":\"secondary\"}");
        var result = FeatureValueCodec.ResolveEnvelope(doc.RootElement);
        Assert.NotNull(result);
        Assert.Equal("primary", result!.Value.Raw.GetString());
    }

    [Fact]
    public void ResolveEnvelopeFallsBackToConfigurationValueWhenValueAbsent()
    {
        using var doc = JsonDocument.Parse("{\"enabled\":true,\"configurationValue\":\"fallback\"}");
        var result = FeatureValueCodec.ResolveEnvelope(doc.RootElement);
        Assert.NotNull(result);
        Assert.Equal("fallback", result!.Value.Raw.GetString());
    }

    [Fact]
    public void ResolveEnvelopeDefaultsValueTypeToNullWhenDeclaredTypeIsNonString()
    {
        using var doc = JsonDocument.Parse("{\"enabled\":true,\"value\":\"x\",\"valueType\":42}");
        var result = FeatureValueCodec.ResolveEnvelope(doc.RootElement);
        Assert.NotNull(result);
        Assert.Null(result!.Value.ValueType);
    }
}
