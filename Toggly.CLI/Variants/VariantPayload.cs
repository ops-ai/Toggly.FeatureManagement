using System.Text.Json;

namespace Toggly.CLI.Variants;

/// <summary>
/// Parses and validates <c>--variants</c> / <c>--allocation</c> JSON payloads
/// for create/update feature commands. Mirrors the SaaS variant/allocation
/// wire shape (<c>Toggly.Services.Data.FeatureVariant</c> /
/// <c>FeatureVariantAllocation</c>) without requiring hand-authored JSON for
/// common mistakes (duplicate names, unknown variant references, bad ranges).
/// </summary>
public static class VariantPayload
{
    private static readonly string[] AllowedStatusOverrides = ["None", "Enabled", "Disabled"];

    /// <summary>Parses a <c>--variants</c> JSON array and validates it.</summary>
    public static bool TryParseVariants(string json, out List<VariantModel> variants, out string errorMessage)
    {
        variants = [];
        errorMessage = string.Empty;

        try
        {
            variants = JsonSerializer.Deserialize(json, TogglyJsonSerializerContext.Default.ListVariantModel) ?? [];
        }
        catch (JsonException ex)
        {
            errorMessage = $"Error parsing variants: {ex.Message}";
            return false;
        }

        var errors = ValidateVariants(variants);
        if (errors.Count > 0)
        {
            errorMessage = string.Join("; ", errors);
            return false;
        }

        return true;
    }

    /// <summary>Parses an <c>--allocation</c> JSON object and validates it.</summary>
    public static bool TryParseAllocation(
        string json,
        out VariantAllocationModel? allocation,
        out string errorMessage,
        IReadOnlyCollection<string>? knownVariantNames = null)
    {
        allocation = null;
        errorMessage = string.Empty;

        try
        {
            allocation = JsonSerializer.Deserialize(json, TogglyJsonSerializerContext.Default.VariantAllocationModel);
        }
        catch (JsonException ex)
        {
            errorMessage = $"Error parsing allocation: {ex.Message}";
            return false;
        }

        var errors = ValidateAllocation(allocation, knownVariantNames);
        if (errors.Count > 0)
        {
            errorMessage = string.Join("; ", errors);
            return false;
        }

        return true;
    }

    /// <summary>
    /// Validates a variant list: non-empty names, no duplicates (case-insensitive),
    /// and a recognized <c>statusOverride</c> value.
    /// </summary>
    public static IReadOnlyList<string> ValidateVariants(List<VariantModel>? variants)
    {
        var errors = new List<string>();
        if (variants is null)
            return errors;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var variant in variants)
        {
            if (string.IsNullOrWhiteSpace(variant.Name))
            {
                errors.Add("Variant name is required.");
                continue;
            }

            if (!seen.Add(variant.Name))
                errors.Add($"Duplicate variant name '{variant.Name}'.");

            if (!AllowedStatusOverrides.Contains(variant.StatusOverride, StringComparer.OrdinalIgnoreCase))
                errors.Add(
                    $"Variant '{variant.Name}' has invalid statusOverride '{variant.StatusOverride}'. " +
                    $"Expected one of: {string.Join(", ", AllowedStatusOverrides)}.");
        }

        return errors;
    }

    /// <summary>
    /// Validates an allocation payload: variant references (when
    /// <paramref name="knownVariantNames"/> is supplied), non-empty user/group
    /// lists, and percentile range sanity (0-100, From &lt; To).
    /// </summary>
    public static IReadOnlyList<string> ValidateAllocation(
        VariantAllocationModel? allocation,
        IReadOnlyCollection<string>? knownVariantNames = null)
    {
        var errors = new List<string>();
        if (allocation is null)
            return errors;

        var known = knownVariantNames;

        bool IsKnownVariant(string? variant) =>
            known is null || known.Count == 0 || string.IsNullOrWhiteSpace(variant) ||
            known.Contains(variant, StringComparer.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(allocation.DefaultWhenEnabled) && !IsKnownVariant(allocation.DefaultWhenEnabled))
            errors.Add($"Allocation 'defaultWhenEnabled' references unknown variant '{allocation.DefaultWhenEnabled}'.");

        if (!string.IsNullOrWhiteSpace(allocation.DefaultWhenDisabled) && !IsKnownVariant(allocation.DefaultWhenDisabled))
            errors.Add($"Allocation 'defaultWhenDisabled' references unknown variant '{allocation.DefaultWhenDisabled}'.");

        foreach (var user in allocation.User ?? [])
        {
            if (string.IsNullOrWhiteSpace(user.Variant))
                errors.Add("User allocation requires a variant name.");
            else if (!IsKnownVariant(user.Variant))
                errors.Add($"User allocation references unknown variant '{user.Variant}'.");

            if (user.Users is null || user.Users.Count == 0)
                errors.Add($"User allocation for variant '{user.Variant}' requires at least one user.");
        }

        foreach (var group in allocation.Group ?? [])
        {
            if (string.IsNullOrWhiteSpace(group.Variant))
                errors.Add("Group allocation requires a variant name.");
            else if (!IsKnownVariant(group.Variant))
                errors.Add($"Group allocation references unknown variant '{group.Variant}'.");

            if (group.Groups is null || group.Groups.Count == 0)
                errors.Add($"Group allocation for variant '{group.Variant}' requires at least one group.");
        }

        foreach (var percentile in allocation.Percentile ?? [])
        {
            if (string.IsNullOrWhiteSpace(percentile.Variant))
                errors.Add("Percentile allocation requires a variant name.");
            else if (!IsKnownVariant(percentile.Variant))
                errors.Add($"Percentile allocation references unknown variant '{percentile.Variant}'.");

            if (percentile.From is < 0 or > 100)
                errors.Add($"Percentile allocation 'from' must be between 0 and 100 (got {percentile.From}).");

            if (percentile.To is < 0 or > 100)
                errors.Add($"Percentile allocation 'to' must be between 0 and 100 (got {percentile.To}).");

            if (percentile.To <= percentile.From)
                errors.Add($"Percentile allocation 'to' ({percentile.To}) must be greater than 'from' ({percentile.From}).");
        }

        return errors;
    }
}
