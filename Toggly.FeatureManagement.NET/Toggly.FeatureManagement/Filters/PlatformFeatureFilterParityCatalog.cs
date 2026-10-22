#nullable enable

using System;
using System.Collections.Generic;
using System.Linq;

namespace Toggly.FeatureManagement.Filters
{
    /// <summary>
    /// Canonical platform filter names and aliases (filter-parity contract + catalog seeds).
    /// </summary>
    public static class PlatformFeatureFilterParityCatalog
    {
        /// <summary>
        /// Wire names from <c>StandardFilterCatalog</c>, dashboard/catalog validation, and filter-parity docs.
        /// </summary>
        public static IEnumerable<string> AllWireNames { get; } = new[]
        {
            "AlwaysOn",
            "Percentage",
            "Targeting",
            "TimeWindow",
            "ContextProperty",
            "UserClaims",
            "BrowserFamily",
            "BrowserLanguage",
            "Country",
            "CountryFamily",
            "DeviceType",
            "OS",
            "OperatingSystem",
            "Microsoft.Percentage",
            "Microsoft.Targeting",
            "Microsoft.TimeWindow"
        };

        /// <summary>
        /// Every wire name and documented alias that must resolve to a registered filter after mapping.
        /// </summary>
        public static IEnumerable<string> AllResolvableNames =>
            AllWireNames.Distinct(StringComparer.OrdinalIgnoreCase);
    }
}
