using Toggly.CLI.Filters;
using Toggly.CLI.Models;

namespace Toggly.CLI.UnleashMigration;

/// <summary>
/// Result of mapping one or more Unleash strategies into Toggly filters.
/// </summary>
public readonly record struct UnleashStrategyMapResult(
    List<FeatureFilter> Filters,
    UnleashMappingStatus Status,
    string Note);

/// <summary>
/// Maps Unleash activation strategies into Toggly <see cref="FeatureFilter"/> lists.
/// Uses <see cref="FilterBuilder"/> so Targeting wire shape is <c>Audience.Users:0</c> (OPS-1646).
/// </summary>
public static class UnleashStrategyMapper
{
    /// <summary>
    /// Constraint operators that can be noted as best-effort ContextProperty candidates.
    /// Everything else is treated as unsupported → Partial.
    /// </summary>
    private static readonly HashSet<string> SupportedConstraintOperators = new(StringComparer.OrdinalIgnoreCase)
    {
        "IN",
        "NOT_IN",
        "STR_CONTAINS",
        "STR_STARTS_WITH",
        "STR_ENDS_WITH",
        "NUM_EQ",
        "NUM_GT",
        "NUM_GTE",
        "NUM_LT",
        "NUM_LTE"
    };

    /// <summary>
    /// Maps a collection of Unleash strategies into Toggly filters and an aggregate status.
    /// </summary>
    /// <param name="strategies">Unleash strategies to map.</param>
    /// <param name="featureKey">
    /// Optional feature key used to detect flexibleRollout <c>groupId</c> mismatches.
    /// </param>
    public static UnleashStrategyMapResult Map(IEnumerable<UnleashStrategyDto>? strategies, string? featureKey = null)
    {
        var filters = new List<FeatureFilter>();
        var notes = new List<string>();
        var sawMapped = false;
        var sawPartial = false;
        var sawSkipped = false;

        foreach (var strategy in strategies ?? [])
        {
            if (strategy.Disabled)
                continue;

            var single = MapStrategy(strategy, featureKey);
            filters.AddRange(single.Filters);

            switch (single.Status)
            {
                case UnleashMappingStatus.Mapped:
                    sawMapped = true;
                    break;
                case UnleashMappingStatus.Partial:
                    sawPartial = true;
                    break;
                case UnleashMappingStatus.Skipped:
                    sawSkipped = true;
                    break;
            }

            if (!string.IsNullOrWhiteSpace(single.Note))
                notes.Add(single.Note);
        }

        var status = AggregateStatus(sawMapped, sawPartial, sawSkipped, filters.Count);
        return new UnleashStrategyMapResult(filters, status, string.Join("; ", notes));
    }

    /// <summary>
    /// Note attached to every Percentage mapping: Toggly runtime hashing differs from Unleash.
    /// </summary>
    public const string PercentageHashParityNote =
        "freeze rollout during cutover — Toggly Percentage uses SHA-256, Unleash uses murmur3";

    /// <summary>
    /// Maps a single Unleash strategy.
    /// </summary>
    public static UnleashStrategyMapResult MapStrategy(UnleashStrategyDto strategy, string? featureKey = null)
    {
        ArgumentNullException.ThrowIfNull(strategy);

        if (strategy.Segments is { Count: > 0 })
        {
            var ids = string.Join(", ", strategy.Segments);
            return Skip($"segments not imported (ids: {ids})");
        }

        var name = strategy.Name?.Trim() ?? string.Empty;
        var constraintNote = EvaluateConstraints(strategy.Constraints, out var constraintsPartial);

        UnleashStrategyMapResult core = name.ToLowerInvariant() switch
        {
            "default" => MapDefault(),
            "userwithid" => MapUserWithId(strategy),
            "flexiblerollout" => MapFlexibleRollout(strategy, featureKey),
            "gradualrolloutuserid" => MapGradualRollout(strategy, stickinessHint: "userId"),
            "gradualrolloutsessionid" => MapGradualRollout(strategy, stickinessHint: "sessionId"),
            "gradualrolloutrandom" => MapGradualRollout(strategy, stickinessHint: "random"),
            "remoteaddress" => Skip("remoteAddress strategy unsupported in v1"),
            "hostname" => Skip("hostname strategy unsupported in v1"),
            _ => Skip($"custom strategy {name}")
        };

        if (!constraintsPartial)
            return AppendNote(core, constraintNote);

        var status = core.Status == UnleashMappingStatus.Skipped
            ? UnleashMappingStatus.Skipped
            : UnleashMappingStatus.Partial;
        var note = JoinNotes(core.Note, constraintNote);
        return new UnleashStrategyMapResult(core.Filters, status, note);
    }

    private static UnleashStrategyMapResult MapDefault()
        => new(
            [FilterBuilder.AlwaysOn()],
            UnleashMappingStatus.Mapped,
            "default → AlwaysOn");

    private static UnleashStrategyMapResult MapUserWithId(UnleashStrategyDto strategy)
    {
        var raw = GetParameter(strategy, "userIds") ?? string.Empty;
        var users = raw
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();

        var filter = FilterBuilder.Targeting(users: users);

        if (users.Count == 0)
        {
            return new UnleashStrategyMapResult(
                [filter],
                UnleashMappingStatus.Partial,
                "userWithId with empty userIds → Targeting (empty audience)");
        }

        return new UnleashStrategyMapResult(
            [filter],
            UnleashMappingStatus.Mapped,
            "userWithId → Targeting");
    }

    private static UnleashStrategyMapResult MapFlexibleRollout(UnleashStrategyDto strategy, string? featureKey)
    {
        var percentage = ReadPercentage(strategy);
        var stickiness = GetParameter(strategy, "stickiness") ?? "default";
        var groupId = GetParameter(strategy, "groupId");
        var filter = FilterBuilder.Percentage(percentage);

        var notes = new List<string>();

        if (!UnleashStickiness.IsStickinessSupported(stickiness))
        {
            notes.Add(
                $"flexibleRollout stickiness={stickiness} unsupported; mapped Percentage ({percentage}%)");
        }
        else
        {
            notes.Add($"flexibleRollout → Percentage ({percentage}%, stickiness={stickiness})");
        }

        notes.Add(PercentageHashParityNote);

        if (!string.IsNullOrWhiteSpace(featureKey)
            && !string.IsNullOrWhiteSpace(groupId)
            && !string.Equals(groupId, featureKey, StringComparison.Ordinal))
        {
            notes.Add(
                $"flexibleRollout groupId={groupId} differs from feature key {featureKey}; stickiness buckets may not match Unleash");
        }

        return new UnleashStrategyMapResult(
            [filter],
            UnleashMappingStatus.Partial,
            string.Join("; ", notes));
    }

    private static UnleashStrategyMapResult MapGradualRollout(UnleashStrategyDto strategy, string stickinessHint)
    {
        var percentage = ReadPercentage(strategy);
        var filter = FilterBuilder.Percentage(percentage);

        if (stickinessHint is "userId")
        {
            return new UnleashStrategyMapResult(
                [filter],
                UnleashMappingStatus.Partial,
                $"gradualRolloutUserId → Percentage ({percentage}%); {PercentageHashParityNote}");
        }

        return new UnleashStrategyMapResult(
            [filter],
            UnleashMappingStatus.Partial,
            $"gradualRollout stickiness={stickinessHint} unsupported; mapped Percentage ({percentage}%); {PercentageHashParityNote}");
    }

    private static int ReadPercentage(UnleashStrategyDto strategy)
    {
        var raw = GetParameter(strategy, "rollout")
                  ?? GetParameter(strategy, "percentage")
                  ?? "0";
        return int.TryParse(raw, out var value)
            ? Math.Clamp(value, 0, 100)
            : 0;
    }

    private static string? GetParameter(UnleashStrategyDto strategy, string key)
    {
        if (strategy.Parameters == null)
            return null;
        return strategy.Parameters.TryGetValue(key, out var value) ? value : null;
    }

    private static string EvaluateConstraints(List<UnleashConstraintDto>? constraints, out bool partial)
    {
        partial = false;
        if (constraints == null || constraints.Count == 0)
            return string.Empty;

        var notes = new List<string>();
        foreach (var constraint in constraints)
        {
            var op = constraint.Operator?.Trim() ?? string.Empty;
            if (SupportedConstraintOperators.Contains(op))
            {
                partial = true;
                notes.Add($"constraint {constraint.ContextName} {op} best-effort (ContextProperty not auto-applied in mapper)");
            }
            else
            {
                partial = true;
                notes.Add($"unsupported constraint operator {op}");
            }
        }

        return string.Join("; ", notes);
    }

    private static UnleashStrategyMapResult Skip(string note)
        => new([], UnleashMappingStatus.Skipped, note);

    private static UnleashStrategyMapResult AppendNote(UnleashStrategyMapResult result, string extra)
    {
        if (string.IsNullOrWhiteSpace(extra))
            return result;
        return result with { Note = JoinNotes(result.Note, extra) };
    }

    private static string JoinNotes(string? left, string? right)
        => string.Join("; ", new[] { left, right }.Where(s => !string.IsNullOrWhiteSpace(s)));

    private static UnleashMappingStatus AggregateStatus(bool sawMapped, bool sawPartial, bool sawSkipped, int filterCount)
    {
        if (sawPartial)
            return UnleashMappingStatus.Partial;
        if (sawSkipped && sawMapped)
            return UnleashMappingStatus.Partial;
        if (sawSkipped && filterCount == 0)
            return UnleashMappingStatus.Skipped;
        if (sawMapped)
            return UnleashMappingStatus.Mapped;
        return filterCount == 0 ? UnleashMappingStatus.Skipped : UnleashMappingStatus.Mapped;
    }
}
