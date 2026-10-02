using Toggly.CLI.Filters;
using Xunit;

namespace Toggly.CLI.Tests.Filters;

public class FilterBuilderTests
{
    [Fact]
    public void AlwaysOn_BuildsEmptyParameters()
    {
        var filter = FilterBuilder.AlwaysOn();

        Assert.Equal("AlwaysOn", filter.Name);
        Assert.NotNull(filter.Parameters);
        Assert.Empty(filter.Parameters);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(50)]
    [InlineData(100)]
    public void Percentage_BuildsValueParameter(double value)
    {
        var filter = FilterBuilder.Percentage(value);

        Assert.Equal("Percentage", filter.Name);
        Assert.Equal(value, Assert.Contains("Value", filter.Parameters!));
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(100.01)]
    public void Percentage_RejectsOutOfRangeValue(double value)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => FilterBuilder.Percentage(value));
    }

    [Fact]
    public void Targeting_BuildsFlattenedAudienceKeys()
    {
        var filter = FilterBuilder.Targeting(
            users: ["alice", "bob"],
            groups: ["beta"],
            defaultRolloutPercentage: 25,
            ignoreCase: true);

        Assert.Equal("Targeting", filter.Name);
        Assert.Equal("alice", filter.Parameters!["Audience.Users:0"]);
        Assert.Equal("bob", filter.Parameters!["Audience.Users:1"]);
        Assert.Equal("beta", filter.Parameters!["Audience.Groups:0"]);
        Assert.Equal(25d, filter.Parameters!["Audience.DefaultRolloutPercentage"]);
        Assert.True((bool)filter.Parameters!["IgnoreCase"]);
    }

    [Fact]
    public void Targeting_WithNoArguments_BuildsEmptyParameters()
    {
        var filter = FilterBuilder.Targeting();

        Assert.Equal("Targeting", filter.Name);
        Assert.Empty(filter.Parameters!);
    }

    [Fact]
    public void Targeting_RejectsOutOfRangeDefaultRollout()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => FilterBuilder.Targeting(defaultRolloutPercentage: 150));
    }

    [Fact]
    public void TimeWindow_RequiresAtLeastOneBound()
    {
        Assert.Throws<ArgumentException>(() => FilterBuilder.TimeWindow(null, null));
    }

    [Fact]
    public void TimeWindow_RejectsEndBeforeStart()
    {
        var start = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var end = start.AddDays(-1);

        Assert.Throws<ArgumentException>(() => FilterBuilder.TimeWindow(start, end));
    }

    [Fact]
    public void TimeWindow_BuildsIso8601Bounds()
    {
        var start = new DateTimeOffset(2020, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var end = new DateTimeOffset(2099, 12, 31, 23, 59, 59, TimeSpan.Zero);

        var filter = FilterBuilder.TimeWindow(start, end);

        Assert.Equal("TimeWindow", filter.Name);
        Assert.Equal("2020-01-01T00:00:00.0000000Z", filter.Parameters!["Start"]);
        Assert.Equal("2099-12-31T23:59:59.0000000Z", filter.Parameters!["End"]);
    }

    [Fact]
    public void TimeWindow_AllowsStartOnly()
    {
        var start = DateTimeOffset.UtcNow;
        var filter = FilterBuilder.TimeWindow(start, null);

        Assert.True(filter.Parameters!.ContainsKey("Start"));
        Assert.False(filter.Parameters!.ContainsKey("End"));
    }
}
