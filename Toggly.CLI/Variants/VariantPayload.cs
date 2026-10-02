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

            if (variant.StatusOverride is null)
            {
                errors.Add(
                    $"Variant '{variant.Name}' has statusOverride null. " +
                    $"Expected one of: {string.Join(", ", AllowedStatusOverrides)}.");
            }
            else if (!AllowedStatusOverrides.Contains(variant.StatusOverride, StringComparer.OrdinalIgnoreCase))
            {
                errors.Add(
                    $"Variant '{variant.Name}' has invalid statusOverride '{variant.StatusOverride}'. " +
                    $"Expected one of: {string.Join(", ", AllowedStatusOverrides)}.");
            }
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

        errors.AddRange(ValidateDefaultVariantReferences(allocation, knownVariantNames));
        errors.AddRange(ValidateUserAllocations(allocation.User, knownVariantNames));
        errors.AddRange(ValidateGroupAllocations(allocation.Group, knownVariantNames));
        errors.AddRange(ValidatePercentileAllocations(allocation.Percentile, knownVariantNames));

        return errors;
    }

    private static bool IsKnownVariant(string? variant, IReadOnlyCollection<string>? knownVariantNames) =>
        knownVariantNames is null || knownVariantNames.Count == 0 || string.IsNullOrWhiteSpace(variant)
            || knownVariantNames.Contains(variant, StringComparer.OrdinalIgnoreCase);

    private static IEnumerable<string> ValidateDefaultVariantReferences(
        VariantAllocationModel allocation,
        IReadOnlyCollection<string>? knownVariantNames)
    {
        if (!string.IsNullOrWhiteSpace(allocation.DefaultWhenEnabled) && !IsKnownVariant(allocation.DefaultWhenEnabled, knownVariantNames))
            yield return $"Allocation 'defaultWhenEnabled' references unknown variant '{allocation.DefaultWhenEnabled}'.";

        if (!string.IsNullOrWhiteSpace(allocation.DefaultWhenDisabled) && !IsKnownVariant(allocation.DefaultWhenDisabled, knownVariantNames))
            yield return $"Allocation 'defaultWhenDisabled' references unknown variant '{allocation.DefaultWhenDisabled}'.";
    }

    private static IEnumerable<string> ValidateUserAllocations(
        List<UserAllocationModel>? users,
        IReadOnlyCollection<string>? knownVariantNames)
    {
        foreach (var user in users ?? [])
        {
            if (string.IsNullOrWhiteSpace(user.Variant))
                yield return "User allocation requires a variant name.";
            else if (!IsKnownVariant(user.Variant, knownVariantNames))
                yield return $"User allocation references unknown variant '{user.Variant}'.";

            if (user.Users is null || user.Users.Count == 0)
                yield return $"User allocation for variant '{user.Variant}' requires at least one user.";
        }
    }

    private static IEnumerable<string> ValidateGroupAllocations(
        List<GroupAllocationModel>? groups,
        IReadOnlyCollection<string>? knownVariantNames)
    {
        foreach (var group in groups ?? [])
        {
            if (string.IsNullOrWhiteSpace(group.Variant))
                yield return "Group allocation requires a variant name.";
            else if (!IsKnownVariant(group.Variant, knownVariantNames))
                yield return $"Group allocation references unknown variant '{group.Variant}'.";

            if (group.Groups is null || group.Groups.Count == 0)
                yield return $"Group allocation for variant '{group.Variant}' requires at least one group.";
        }
    }

    private static IEnumerable<string> ValidatePercentileAllocations(
        List<PercentileAllocationModel>? percentiles,
        IReadOnlyCollection<string>? knownVariantNames)
    {
        foreach (var percentile in percentiles ?? [])
        {
            if (string.IsNullOrWhiteSpace(percentile.Variant))
                yield return "Percentile allocation requires a variant name.";
            else if (!IsKnownVariant(percentile.Variant, knownVariantNames))
                yield return $"Percentile allocation references unknown variant '{percentile.Variant}'.";

            if (percentile.From is < 0 or > 100)
                yield return $"Percentile allocation 'from' must be between 0 and 100 (got {percentile.From}).";

            if (percentile.To is < 0 or > 100)
                yield return $"Percentile allocation 'to' must be between 0 and 100 (got {percentile.To}).";

            if (percentile.To <= percentile.From)
                yield return $"Percentile allocation 'to' ({percentile.To}) must be greater than 'from' ({percentile.From}).";
        }
    }
}
