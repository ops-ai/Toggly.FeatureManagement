using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class PercentileGoldenTests
{
    private static readonly string GoldenPath = Path.Combine(
        AppContext.BaseDirectory,
        "testdata",
        "eval-percentile-golden.json");

    public static IEnumerable<object[]> GoldenRows()
    {
        var json = File.ReadAllText(GoldenPath);
        var rows = JsonSerializer.Deserialize<List<GoldenRow>>(json, new JsonSerializerOptions
                   {
                       PropertyNameCaseInsensitive = true
                   })
                   ?? throw new InvalidOperationException("Failed to deserialize golden vectors");

        foreach (var row in rows)
            yield return new object[] { row.FeatureKey, row.UserId, row.Bucket };
    }

    [Theory]
    [MemberData(nameof(GoldenRows))]
    public void Compute_MatchesGoldenVectors(string featureKey, string userId, double expectedBucket)
    {
        var got = Percentile.Compute(featureKey, userId);

        got.Should().BeApproximately(expectedBucket, 1e-9);
    }

    [Fact]
    public void Compute_ReversedMicrosoftOrder_DoesNotMatchGolden()
    {
        // Stock MF hashes userId\nfeatureKey — must NOT match Definitions buckets.
        var mfStyle = Percentile.Compute("user-123", "demo-feature");
        var definitionsStyle = Percentile.Compute("demo-feature", "user-123");

        mfStyle.Should().NotBeApproximately(definitionsStyle, 1e-9);
        definitionsStyle.Should().BeApproximately(60.099955033534194, 1e-9);
    }

    [Theory]
    [InlineData("demo-feature", "user-123", 61, true)]
    [InlineData("demo-feature", "user-123", 60, false)]
    [InlineData("demo-feature", "user-123", 0, false)]
    [InlineData("demo-feature", "user-123", 100, true)]
    public void IsInRollout_UsesStrictLessThan(string featureKey, string userId, double percentage, bool expected)
    {
        Percentile.IsInRollout(featureKey, userId, percentage).Should().Be(expected);
    }

    [Fact]
    public void Compute_NullFeatureKey_Throws()
    {
        Action act = () => Percentile.Compute(null!, "user-123");
        act.Should().Throw<ArgumentNullException>().And.ParamName.Should().Be("featureKey");
    }

    [Fact]
    public void Compute_NullUserId_Throws()
    {
        Action act = () => Percentile.Compute("demo-feature", null!);
        act.Should().Throw<ArgumentNullException>().And.ParamName.Should().Be("userId");
    }

    private sealed class GoldenRow
    {
        public string FeatureKey { get; set; } = "";
        public string UserId { get; set; } = "";
        public double Bucket { get; set; }
    }
}
