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
}
