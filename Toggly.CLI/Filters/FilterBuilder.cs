using Toggly.CLI.Models;

namespace Toggly.CLI.Filters;

/// <summary>
/// Builds catalog-valid <see cref="FeatureFilter"/> instances for the hybrid
/// first-class filters (AlwaysOn, Percentage, Targeting, TimeWindow) so CLI
/// commands and callers do not need to hand-author filter JSON.
/// </summary>
public static class FilterBuilder
{
    /// <summary>Builds the AlwaysOn filter (no parameters).</summary>
    public static FeatureFilter AlwaysOn() =>
        new() { Name = StandardFilterCatalog.AlwaysOn, Parameters = new Dictionary<string, object>() };

    /// <summary>
    /// Builds the Percentage filter. <paramref name="value"/> must be within [0, 100].
    /// </summary>
    public static FeatureFilter Percentage(double value)
    {
        if (value is < 0 or > 100)
            throw new ArgumentOutOfRangeException(nameof(value), value, "Percentage value must be between 0 and 100.");

        return new FeatureFilter
        {
            Name = StandardFilterCatalog.Percentage,
            Parameters = new Dictionary<string, object> { ["Value"] = value }
        };
    }

    /// <summary>
    /// Builds the Targeting filter using the Microsoft audience configuration
    /// shape (flattened <c>Audience.Users:0</c> / <c>Audience.Groups:0</c> index
    /// keys), matching the wire shape documented in the OPS-1646 design.
    /// </summary>
    public static FeatureFilter Targeting(
        IReadOnlyList<string>? users = null,
        IReadOnlyList<string>? groups = null,
        double? defaultRolloutPercentage = null,
        bool? ignoreCase = null)
    {
        if (defaultRolloutPercentage is < 0 or > 100)
            throw new ArgumentOutOfRangeException(
                nameof(defaultRolloutPercentage),
                defaultRolloutPercentage,
                "Targeting default rollout percentage must be between 0 and 100.");

        var parameters = new Dictionary<string, object>();

        if (users is not null)
            for (var i = 0; i < users.Count; i++)
                parameters[$"Audience.Users:{i}"] = users[i];

        if (groups is not null)
            for (var i = 0; i < groups.Count; i++)
                parameters[$"Audience.Groups:{i}"] = groups[i];

        if (defaultRolloutPercentage is not null)
            parameters["Audience.DefaultRolloutPercentage"] = defaultRolloutPercentage.Value;

        if (ignoreCase is not null)
            parameters["IgnoreCase"] = ignoreCase.Value;

        return new FeatureFilter { Name = StandardFilterCatalog.Targeting, Parameters = parameters };
    }

    /// <summary>
    /// Builds the TimeWindow filter. At least one of <paramref name="start"/> /
    /// <paramref name="end"/> is required; when both are given, <paramref name="end"/>
    /// must be strictly after <paramref name="start"/>.
    /// </summary>
    public static FeatureFilter TimeWindow(DateTimeOffset? start, DateTimeOffset? end)
    {
        if (start is null && end is null)
            throw new ArgumentException("TimeWindow requires at least one of 'start' or 'end'.");

        if (start is not null && end is not null && end <= start)
            throw new ArgumentException("TimeWindow 'end' must be after 'start'.");

        var parameters = new Dictionary<string, object>();
        if (start is not null)
            parameters["Start"] = start.Value.UtcDateTime.ToString("o");
        if (end is not null)
            parameters["End"] = end.Value.UtcDateTime.ToString("o");

        return new FeatureFilter { Name = StandardFilterCatalog.TimeWindow, Parameters = parameters };
    }
}
