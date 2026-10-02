using Toggly.CLI.Variants;
using Xunit;

namespace Toggly.CLI.Tests.Variants;

public class VariantPayloadTests
{
    [Fact]
    public void TryParseVariants_ParsesCanonicalShape()
    {
        const string json = """
            [
              {"name":"Control","configurationValue":false,"statusOverride":"None"},
              {"name":"Treatment","configurationValue":true,"statusOverride":"None"}
            ]
            """;

        var ok = VariantPayload.TryParseVariants(json, out var variants, out var error);

        Assert.True(ok, error);
        Assert.Equal(2, variants.Count);
        Assert.Equal("Control", variants[0].Name);
    }

    [Fact]
    public void TryParseVariants_DefaultsStatusOverrideToNone()
    {
        const string json = """[{"name":"Control"}]""";

        var ok = VariantPayload.TryParseVariants(json, out var variants, out var error);

        Assert.True(ok, error);
        Assert.Equal("None", variants[0].StatusOverride);
    }

    [Fact]
    public void TryParseVariants_ReturnsFalseOnInvalidJson()
    {
        var ok = VariantPayload.TryParseVariants("not json", out var variants, out var error);

        Assert.False(ok);
        Assert.Empty(variants);
        Assert.Contains("Error parsing variants", error);
    }

    [Fact]
    public void TryParseVariants_RejectsDuplicateNames()
    {
        const string json = """[{"name":"A"},{"name":"a"}]""";

        var ok = VariantPayload.TryParseVariants(json, out _, out var error);

        Assert.False(ok);
        Assert.Contains("Duplicate variant name", error);
    }

    [Fact]
    public void TryParseVariants_RejectsInvalidStatusOverride()
    {
        const string json = """[{"name":"A","statusOverride":"Maybe"}]""";

        var ok = VariantPayload.TryParseVariants(json, out _, out var error);

        Assert.False(ok);
        Assert.Contains("invalid statusOverride", error);
    }

    [Fact]
    public void TryParseVariants_RejectsNullStatusOverrideWithExplicitMessage()
    {
        const string json = """[{"name":"A","statusOverride":null}]""";

        var ok = VariantPayload.TryParseVariants(json, out _, out var error);

        Assert.False(ok);
        Assert.Contains("statusOverride null", error);
        Assert.DoesNotContain("invalid statusOverride ''", error);
    }

    [Fact]
    public void TryParseAllocation_ParsesPercentileAllocation()
    {
        const string json = """
            {
              "defaultWhenEnabled": "Control",
              "percentile": [
                {"variant":"Control","from":0,"to":50},
                {"variant":"Treatment","from":50,"to":100}
              ],
              "seed": "my-feature"
            }
            """;

        var ok = VariantPayload.TryParseAllocation(json, out var allocation, out var error, ["Control", "Treatment"]);

        Assert.True(ok, error);
        Assert.Equal("Control", allocation!.DefaultWhenEnabled);
        Assert.Equal(2, allocation.Percentile!.Count);
    }

    [Fact]
    public void TryParseAllocation_ReturnsFalseOnInvalidJson()
    {
        var ok = VariantPayload.TryParseAllocation("not json", out var allocation, out var error);

        Assert.False(ok);
        Assert.Null(allocation);
        Assert.Contains("Error parsing allocation", error);
    }

    [Fact]
    public void TryParseAllocation_RejectsUnknownVariantReference()
    {
        const string json = """{"defaultWhenEnabled":"Ghost"}""";

        var ok = VariantPayload.TryParseAllocation(json, out _, out var error, ["Control", "Treatment"]);

        Assert.False(ok);
        Assert.Contains("unknown variant 'Ghost'", error);
    }

    [Fact]
    public void TryParseAllocation_RejectsInvalidPercentileRange()
    {
        const string json = """{"percentile":[{"variant":"Control","from":60,"to":10}]}""";

        var ok = VariantPayload.TryParseAllocation(json, out _, out var error, ["Control"]);

        Assert.False(ok);
        Assert.Contains("must be greater than 'from'", error);
    }

    [Fact]
    public void TryParseAllocation_RejectsPercentileOutOfBounds()
    {
        const string json = """{"percentile":[{"variant":"Control","from":-5,"to":10}]}""";

        var ok = VariantPayload.TryParseAllocation(json, out _, out var error, ["Control"]);

        Assert.False(ok);
        Assert.Contains("between 0 and 100", error);
    }

    [Fact]
    public void TryParseAllocation_RejectsUserAllocationWithoutUsers()
    {
        const string json = """{"user":[{"variant":"Control","users":[]}]}""";

        var ok = VariantPayload.TryParseAllocation(json, out _, out var error, ["Control"]);

        Assert.False(ok);
        Assert.Contains("requires at least one user", error);
    }

    [Fact]
    public void ValidateAllocation_WithoutKnownVariantNames_SkipsReferenceChecks()
    {
        var allocation = new VariantAllocationModel { DefaultWhenEnabled = "Anything" };

        var errors = VariantPayload.ValidateAllocation(allocation);

        Assert.Empty(errors);
    }
}
