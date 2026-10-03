using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Toggly.CLI.UnleashMigration;

/// <summary>
/// Mapping outcome for a single Unleash feature / strategy during import.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<UnleashMappingStatus>))]
public enum UnleashMappingStatus
{
    /// <summary>Mapped with full supported fidelity.</summary>
    Mapped,

    /// <summary>Imported with warnings / best-effort semantics.</summary>
    Partial,

    /// <summary>
    /// Unsupported strategies (or custom plugins). Feature is still created/updated as off
    /// (empty filters) on <c>--apply</c>; dry-run reports this explicitly.
    /// </summary>
    Skipped
}

/// <summary>
/// One row in an Unleash → Toggly compatibility report.
/// </summary>
public class UnleashCompatibilityReportRow
{
    /// <summary>Feature key the row refers to.</summary>
    public required string FeatureKey { get; set; }

    /// <summary>Mapping status.</summary>
    public UnleashMappingStatus Status { get; set; }

    /// <summary>Human-readable note for CLI / UI.</summary>
    public string Note { get; set; } = string.Empty;
}

/// <summary>
/// JSON DTO for <see cref="UnleashCompatibilityReport.ToJson"/>.
/// </summary>
public sealed class UnleashCompatibilityReportJson
{
    /// <summary>Mapped count.</summary>
    public int MappedCount { get; init; }

    /// <summary>Partial count.</summary>
    public int PartialCount { get; init; }

    /// <summary>Skipped count.</summary>
    public int SkippedCount { get; init; }

    /// <summary>Rows.</summary>
    public required List<UnleashCompatibilityReportRow> Rows { get; init; }
}

/// <summary>
/// In-memory compatibility report with counts and render helpers for the CLI.
/// </summary>
public class UnleashCompatibilityReport
{
    private readonly List<UnleashCompatibilityReportRow> _rows = [];

    /// <summary>All report rows in insertion order.</summary>
    public IReadOnlyList<UnleashCompatibilityReportRow> Rows => _rows;

    /// <summary>Count of <see cref="UnleashMappingStatus.Mapped"/> rows.</summary>
    public int MappedCount => _rows.Count(r => r.Status == UnleashMappingStatus.Mapped);

    /// <summary>Count of <see cref="UnleashMappingStatus.Partial"/> rows.</summary>
    public int PartialCount => _rows.Count(r => r.Status == UnleashMappingStatus.Partial);

    /// <summary>Count of <see cref="UnleashMappingStatus.Skipped"/> rows.</summary>
    public int SkippedCount => _rows.Count(r => r.Status == UnleashMappingStatus.Skipped);

    /// <summary>Adds a row for a feature mapping outcome.</summary>
    public void Add(string featureKey, UnleashMappingStatus status, string note)
    {
        _rows.Add(new UnleashCompatibilityReportRow
        {
            FeatureKey = featureKey,
            Status = status,
            Note = note ?? string.Empty
        });
    }

    /// <summary>Renders a plain-text summary suitable for CLI dry-run output.</summary>
    public string ToText()
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Mapped: {MappedCount}  Partial: {PartialCount}  Skipped: {SkippedCount}");
        foreach (var row in _rows)
            sb.AppendLine($"{row.Status,-8} {row.FeatureKey} — {row.Note}");
        return sb.ToString().TrimEnd();
    }

    /// <summary>Renders the report as JSON for machine consumption.</summary>
    public string ToJson()
    {
        var dto = new UnleashCompatibilityReportJson
        {
            MappedCount = MappedCount,
            PartialCount = PartialCount,
            SkippedCount = SkippedCount,
            Rows = _rows.ToList()
        };
        return JsonSerializer.Serialize(dto, UnleashJsonSerializerContext.Default.UnleashCompatibilityReportJson);
    }
}
