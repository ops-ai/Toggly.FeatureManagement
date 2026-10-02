using System.Text.Json;
using Toggly.CLI.Models;

namespace Toggly.CLI.Filters;

/// <summary>
/// Validates <see cref="FeatureFilter"/> lists (parsed from <c>--filters</c> /
/// <c>--environment-filters</c> JSON or built via <see cref="FilterBuilder"/>)
/// against the standard filter catalog. Fails fast with catalog-path errors
/// per the OPS-1646 design's error-handling table.
/// </summary>
public static class FilterValidator
{
    /// <summary>
    /// Validates a filter list: unknown names and missing required parameters
    /// are reported; value-shape checks are performed for the hybrid filters
    /// where it is cheap and unambiguous (Percentage range, TimeWindow presence).
    /// Returns an empty list when the filters are valid.
    /// </summary>
    public static IReadOnlyList<string> Validate(IEnumerable<FeatureFilter>? filters)
    {
        var errors = new List<string>();
        if (filters is null)
            return errors;

        foreach (var filter in filters)
        {
            if (string.IsNullOrWhiteSpace(filter.Name))
            {
                errors.Add("Filter name is required.");
                continue;
            }

            if (!StandardFilterCatalog.IsKnown(filter.Name))
            {
                errors.Add($"Unknown filter name '{filter.Name}'.");
                continue;
            }

            var missingRequired = StandardFilterCatalog.RequiredParameters[filter.Name]
                .Where(required => filter.Parameters is null || !filter.Parameters.ContainsKey(required));
            foreach (var required in missingRequired)
                errors.Add($"Filter '{filter.Name}' is missing required parameter '{required}'.");

            if (filter.Name == StandardFilterCatalog.TimeWindow)
            {
                var hasStart = filter.Parameters?.ContainsKey("Start") == true;
                var hasEnd = filter.Parameters?.ContainsKey("End") == true;
                if (!hasStart && !hasEnd)
                    errors.Add("Filter 'TimeWindow' requires at least one of 'Start' or 'End'.");
            }

            if (filter.Name == StandardFilterCatalog.Percentage
                && filter.Parameters is not null
                && filter.Parameters.TryGetValue("Value", out var rawValue)
                && !IsValidPercentage(rawValue))
            {
                errors.Add("Filter 'Percentage' parameter 'Value' must be a number between 0 and 100.");
            }
        }

        return errors;
    }

    /// <summary>
    /// Parses a <c>--filters</c>-style JSON array and validates it against the
    /// catalog in one step. Returns false with an error message on JSON parse
    /// failure or catalog validation failure (joined with <c>"; "</c>).
    /// </summary>
    public static bool TryParseAndValidate(string json, out List<FeatureFilter> filters, out string errorMessage)
    {
        filters = [];
        errorMessage = string.Empty;

        try
        {
            filters = JsonSerializer.Deserialize(json, TogglyJsonSerializerContext.Default.ListFeatureFilter) ?? [];
        }
        catch (JsonException ex)
        {
            errorMessage = $"Error parsing filters: {ex.Message}";
            return false;
        }

        var errors = Validate(filters);
        if (errors.Count > 0)
        {
            errorMessage = string.Join("; ", errors);
            return false;
        }

        return true;
    }

    private static bool IsValidPercentage(object? value)
    {
        var number = value switch
        {
            JsonElement element when element.ValueKind == JsonValueKind.Number => element.GetDouble(),
            double d => d,
            int i => i,
            long l => l,
            float f => f,
            _ => (double?)null
        };

        return number is >= 0 and <= 100;
    }
}
