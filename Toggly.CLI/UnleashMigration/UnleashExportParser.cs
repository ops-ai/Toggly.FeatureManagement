using System.Text.Json;

namespace Toggly.CLI.UnleashMigration;

/// <summary>
/// Result of parsing an Unleash export / Admin API feature list payload.
/// </summary>
public sealed class UnleashParseResult
{
    /// <summary>Normalized features ready for mapping.</summary>
    public required IReadOnlyList<UnleashFeatureDto> Features { get; init; }

    /// <summary>Human-readable description of which JSON shape was accepted.</summary>
    public required string AcceptedShape { get; init; }
}

/// <summary>
/// Parses common Unleash export / Admin API JSON shapes into <see cref="UnleashFeatureDto"/> lists.
/// </summary>
/// <remarks>
/// <para><b>Accepted root shapes:</b></para>
/// <list type="bullet">
/// <item><description>Top-level JSON array of feature objects: <c>[{ "name": "...", "strategies": [...] }, ...]</c></description></item>
/// <item><description>Object with a <c>features</c> array (file export or Admin API list): <c>{ "features": [...] }</c></description></item>
/// <item><description>Admin API wrapper with <c>version</c> + <c>features</c> (same as above; <c>version</c> is ignored)</description></item>
/// </list>
/// <para>
/// Per-feature strategies may live on the feature itself or under <c>environments[]</c>.
/// When <paramref name="environmentName"/> is supplied, the matching environment slice
/// (case-insensitive) supplies <c>enabled</c> + <c>strategies</c>. If Unleash environments
/// exist but none match the requested name, the first slice is <b>not</b> used; the
/// feature is marked unmatched so import can skip/partial it. When no environment is
/// requested, feature-level strategies are preferred; otherwise the first slice is used.
/// </para>
/// </remarks>
public static class UnleashExportParser
{
    /// <summary>Parses Unleash JSON from a file path.</summary>
    public static UnleashParseResult ParseFile(string path, string? environmentName = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        var json = File.ReadAllText(path);
        return Parse(json, environmentName);
    }

    /// <summary>Parses Unleash JSON from a UTF-8 stream.</summary>
    public static UnleashParseResult Parse(Stream stream, string? environmentName = null)
    {
        ArgumentNullException.ThrowIfNull(stream);
        using var doc = JsonDocument.Parse(stream);
        return Parse(doc.RootElement, environmentName);
    }

    /// <summary>Parses Unleash JSON text.</summary>
    public static UnleashParseResult Parse(string json, string? environmentName = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(json);
        using var doc = JsonDocument.Parse(json);
        return Parse(doc.RootElement, environmentName);
    }

    /// <summary>Parses a pre-loaded JSON root element.</summary>
    public static UnleashParseResult Parse(JsonElement root, string? environmentName = null)
    {
        List<UnleashFeatureDto> features;
        string shape;

        if (root.ValueKind == JsonValueKind.Array)
        {
            features = DeserializeFeatures(root);
            shape = "top-level features array";
        }
        else if (root.ValueKind == JsonValueKind.Object)
        {
            if (!root.TryGetProperty("features", out var featuresElement)
                || featuresElement.ValueKind != JsonValueKind.Array)
            {
                throw new InvalidOperationException(
                    "Unrecognized Unleash export shape. Expected a top-level features array "
                    + "or an object with a \"features\" array "
                    + "(Unleash file export / Admin API list wrapper).");
            }

            features = DeserializeFeatures(featuresElement);
            shape = root.TryGetProperty("version", out _)
                ? "Admin API wrapper { version, features }"
                : "object with features array";
        }
        else
        {
            throw new InvalidOperationException(
                $"Unrecognized Unleash export root kind: {root.ValueKind}. "
                + "Expected array or object.");
        }

        var normalized = features
            .Select(f => NormalizeForEnvironment(f, environmentName))
            .ToList();

        return new UnleashParseResult
        {
            Features = normalized,
            AcceptedShape = shape
        };
    }

    /// <summary>
    /// Resolves environment-scoped enabled/strategies onto the feature for mapping.
    /// </summary>
    public static UnleashFeatureDto NormalizeForEnvironment(UnleashFeatureDto feature, string? environmentName)
    {
        ArgumentNullException.ThrowIfNull(feature);

        var environments = feature.Environments;
        if (environments is { Count: > 0 } && !string.IsNullOrWhiteSpace(environmentName))
        {
            var match = environments.FirstOrDefault(e =>
                string.Equals(e.Name, environmentName, StringComparison.OrdinalIgnoreCase));
            if (match == null)
            {
                return new UnleashFeatureDto
                {
                    Name = feature.Name,
                    Description = feature.Description,
                    Type = feature.Type,
                    Project = feature.Project,
                    Variants = feature.Variants,
                    Environments = feature.Environments,
                    Enabled = false,
                    Strategies = [],
                    UnmatchedRequestedEnvironment = environmentName,
                    PresentUnleashEnvironmentNames = environments
                        .Select(e => e.Name)
                        .Where(n => !string.IsNullOrWhiteSpace(n))
                        .ToList()
                };
            }

            return CloneWithSlice(feature, match);
        }

        var envSlice = ResolveEnvironmentSlice(feature, environmentName);
        if (envSlice == null)
            return feature;

        return CloneWithSlice(feature, envSlice);
    }

    private static UnleashFeatureDto CloneWithSlice(UnleashFeatureDto feature, UnleashEnvironmentDto envSlice)
        => new()
        {
            Name = feature.Name,
            Description = feature.Description,
            Type = feature.Type,
            Project = feature.Project,
            Variants = feature.Variants,
            Environments = feature.Environments,
            Enabled = envSlice.Enabled,
            Strategies = envSlice.Strategies ?? feature.Strategies
        };

    private static UnleashEnvironmentDto? ResolveEnvironmentSlice(UnleashFeatureDto feature, string? environmentName)
    {
        var environments = feature.Environments;
        if (environments == null || environments.Count == 0)
            return null;

        if (!string.IsNullOrWhiteSpace(environmentName))
        {
            var match = environments.FirstOrDefault(e =>
                string.Equals(e.Name, environmentName, StringComparison.OrdinalIgnoreCase));
            if (match != null)
                return match;

            return null;
        }

        // Prefer feature-level strategies when already present.
        if (feature.Strategies is { Count: > 0 })
            return null;

        return environments[0];
    }

    private static List<UnleashFeatureDto> DeserializeFeatures(JsonElement featuresElement)
    {
        var list = JsonSerializer.Deserialize(
            featuresElement.GetRawText(),
            UnleashJsonSerializerContext.Default.ListUnleashFeatureDto);
        if (list == null)
            throw new InvalidOperationException("Failed to deserialize Unleash features array.");
        return list;
    }
}
