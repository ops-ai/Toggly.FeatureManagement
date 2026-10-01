namespace Toggly.CLI.Filters;

/// <summary>
/// Canonical short-name filter catalog mirrored from the SaaS standard filter
/// seed (<c>Toggly.Services.StandardFilterCatalog</c> / <c>Startup.cs</c> seed
/// block). Used to validate <c>--filters</c> / <c>--environment-filters</c>
/// JSON and to drive the first-class filter builder options.
/// </summary>
public static class StandardFilterCatalog
{
    /// <summary>Always-enabled filter; no parameters.</summary>
    public const string AlwaysOn = "AlwaysOn";

    /// <summary>Sticky percentage rollout filter.</summary>
    public const string Percentage = "Percentage";

    /// <summary>User/group/default-rollout targeting filter (Microsoft audience shape).</summary>
    public const string Targeting = "Targeting";

    /// <summary>Date-range gate filter.</summary>
    public const string TimeWindow = "TimeWindow";

    /// <summary>Application-context property comparison filter.</summary>
    public const string ContextProperty = "ContextProperty";

    /// <summary>User claim comparison filter.</summary>
    public const string UserClaims = "UserClaims";

    /// <summary>Browser language allow-list filter.</summary>
    public const string BrowserLanguage = "BrowserLanguage";

    /// <summary>Operating system allow-list filter.</summary>
    public const string OperatingSystem = "OperatingSystem";

    /// <summary>Browser family allow-list filter.</summary>
    public const string BrowserFamily = "BrowserFamily";

    /// <summary>Country allow-list filter.</summary>
    public const string Country = "Country";

    /// <summary>Device type allow-list filter.</summary>
    public const string DeviceType = "DeviceType";

    /// <summary>
    /// Required parameter names per catalog filter name. An empty array means no
    /// parameter is unconditionally required (either all parameters are optional,
    /// or the filter has an "at least one of" rule enforced separately, e.g. TimeWindow).
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string[]> RequiredParameters =
        new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            [AlwaysOn] = [],
            [Percentage] = ["Value"],
            [Targeting] = [],
            [TimeWindow] = [],
            [ContextProperty] = ["ContextKind", "Property", "Operator", "Value"],
            [UserClaims] = [],
            [BrowserLanguage] = ["BrowserLanguage"],
            [OperatingSystem] = ["OperatingSystem"],
            [BrowserFamily] = ["BrowserFamily"],
            [Country] = ["Country"],
            [DeviceType] = ["DeviceType"],
        };

    /// <summary>All canonical short filter names recognized by the catalog.</summary>
    public static IReadOnlySet<string> KnownNames { get; } =
        new HashSet<string>(RequiredParameters.Keys, StringComparer.Ordinal);

    /// <summary>True when <paramref name="name"/> is a recognized catalog filter name.</summary>
    public static bool IsKnown(string? name) =>
        !string.IsNullOrEmpty(name) && KnownNames.Contains(name);
}
