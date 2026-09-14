using System;
using System.Collections.Generic;
using System.Globalization;

namespace Toggly.FeatureManagement.Catalog
{
    /// <summary>
    /// Expands catalog Targeting list keys into indexed identifier parameters for SDK filters.
    /// </summary>
    public static class CatalogListExpansion
    {
        private static readonly string[] SlotKeys =
        {
            "Audience.Users", "Audience.Groups", "Audience.Exclusion.Users", "Audience.Exclusion.Groups"
        };

        /// <summary>
        /// Copies non-slot Targeting parameters and writes <c>Audience.Users:n</c> (and related) IDs from linked lists.
        /// </summary>
        public static Dictionary<string, string> ExpandTargetingParameters(
            IReadOnlyDictionary<string, string> parameters,
            IReadOnlyDictionary<string, CatalogList> lists)
        {
            var expanded = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var pair in parameters)
            {
                if (IsSlot(pair.Key)) continue;
                expanded[pair.Key] = pair.Value;
            }

            ExpandSlot(parameters, lists, expanded, "Audience.Users", "Audience.Users:");
            ExpandSlot(parameters, lists, expanded, "Audience.Groups", "Audience.Groups:");
            ExpandSlot(parameters, lists, expanded, "Audience.Exclusion.Users", "Audience.Exclusion.Users:");
            ExpandSlot(parameters, lists, expanded, "Audience.Exclusion.Groups", "Audience.Exclusion.Groups:");
            return expanded;
        }

        private static bool IsSlot(string key)
        {
            for (var index = 0; index < SlotKeys.Length; index++)
            {
                if (string.Equals(SlotKeys[index], key, StringComparison.Ordinal)) return true;
            }

            return false;
        }

        private static void ExpandSlot(
            IReadOnlyDictionary<string, string> parameters,
            IReadOnlyDictionary<string, CatalogList> lists,
            IDictionary<string, string> expanded,
            string slot,
            string prefix)
        {
            if (!parameters.TryGetValue(slot, out var listKey) || string.IsNullOrWhiteSpace(listKey)) return;
            if (!lists.TryGetValue(listKey.Trim(), out var list) || list.Items == null) return;
            for (var index = 0; index < list.Items.Count; index++)
            {
                expanded[prefix + index.ToString(CultureInfo.InvariantCulture)] = list.Items[index];
            }
        }
    }
}
