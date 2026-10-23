using System;
using System.Collections.Generic;
using System.Linq;
using UAParser;

namespace Toggly.FeatureManagement.Web.Filters
{
    /// <summary>
    /// Normalizes UAParser output for segment filters to match platform / Elixir backend semantics.
    /// </summary>
    internal static class UserAgentSegmentFields
    {
        /// <summary>
        /// Desktop Mac UAParser device family is <c>Mac</c>; platform catalogs use <c>Macintosh</c>.
        /// </summary>
        internal static string GetDeviceFamily(ClientInfo clientInfo)
        {
            var family = clientInfo.Device.Family ?? string.Empty;
            if (string.Equals(family, "Mac", StringComparison.OrdinalIgnoreCase))
                return "Macintosh";
            return family;
        }

        internal static string GetOperatingSystemFamily(ClientInfo clientInfo) =>
            clientInfo.OS.Family ?? string.Empty;

        internal static string GetBrowserFamily(ClientInfo clientInfo) =>
            clientInfo.UA.Family ?? string.Empty;

        internal static bool MatchesIndexedAllowList(string fieldValue, IEnumerable<string> allowList)
        {
            if (string.IsNullOrWhiteSpace(fieldValue)
                || string.Equals(fieldValue, "Other", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            return allowList != null
                   && allowList.Any(t => !string.IsNullOrWhiteSpace(t)
                                         && fieldValue.Contains(t, StringComparison.OrdinalIgnoreCase));
        }
    }
}
