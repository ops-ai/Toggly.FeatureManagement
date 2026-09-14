using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Embedded;

/// <summary>Previews and applies portable catalog imports against the authoritative embedded store.</summary>
public sealed class EmbeddedImportService
{
    private readonly EmbeddedCatalogEditor _editor;
    private readonly TogglyEmbeddedOptions _options;

    internal EmbeddedImportService(EmbeddedCatalogEditor editor, IOptions<TogglyEmbeddedOptions> options)
    {
        _editor = editor;
        _options = options.Value;
    }

    /// <summary>Validates an uploaded document and returns a revision-bound merge preview.</summary>
    public async Task<EmbeddedImportPreview> PreviewAsync(string payload, CancellationToken cancellationToken = default)
    {
        var document = ParseCanonical(payload);
        var target = await _editor.ReadAsync(cancellationToken).ConfigureAwait(false);
        return Preview(document, target);
    }

    private static EmbeddedImportPreview Preview(CatalogDocument document, CatalogSnapshot? target)
    {
        var targetDocument = target?.Document ?? new CatalogDocument();
        var existing = targetDocument.Features.ToDictionary(feature => feature.Key, StringComparer.OrdinalIgnoreCase);

        return new EmbeddedImportPreview(
            CanonicalPayload: CatalogJson.Serialize(document),
            Fingerprint: Fingerprint(CatalogJson.Serialize(document)),
            ExpectedRevision: target?.Revision,
            AddKeys: document.Features.Where(feature => !existing.ContainsKey(feature.Key)).Select(feature => feature.Key).OrderBy(key => key, StringComparer.Ordinal).ToArray(),
            IdenticalKeys: document.Features.Where(feature => existing.TryGetValue(feature.Key, out var current) && FeaturesEqual(current, feature)).Select(feature => feature.Key).OrderBy(key => key, StringComparer.Ordinal).ToArray(),
            ConflictKeys: document.Features.Where(feature => existing.TryGetValue(feature.Key, out var current) && !FeaturesEqual(current, feature)).Select(feature => feature.Key).OrderBy(key => key, StringComparer.Ordinal).ToArray(),
            ContextConflictKinds: document.Contexts.Where(context => targetDocument.Contexts.Any(current => string.Equals(current.Kind, context.Kind, StringComparison.OrdinalIgnoreCase) && ContextsConflict(current, context))).Select(context => context.Kind).OrderBy(kind => kind, StringComparer.Ordinal).ToArray());
    }

    /// <summary>Revalidates a preview and performs exactly one optimistic-concurrency write.</summary>
    public async Task<EmbeddedImportApplyResult> ApplyAsync(EmbeddedImportApplyRequest request, CancellationToken cancellationToken = default)
    {
        var document = ParseCanonical(request.CanonicalPayload);
        if (!FixedTimeFingerprintEquals(Fingerprint(CatalogJson.Serialize(document)), request.Fingerprint))
            throw Validation("fingerprint", "The import preview is invalid. Create a new preview.");

        var target = await _editor.ReadAsync(cancellationToken).ConfigureAwait(false);
        if (!string.Equals(target?.Revision, request.ExpectedRevision, StringComparison.Ordinal))
            return new EmbeddedImportApplyResult(CatalogWriteStatus.Conflict, target, null);

        var preview = Preview(document, target);
        if (preview.ContextConflictKinds.Count > 0)
            throw Validation("contexts", $"Context '{preview.ContextConflictKinds[0]}' conflicts with the current catalog.");

        var selectedAdds = Select(request.SelectedAddKeys, preview.AddKeys, "selectedAddKeys");
        var selectedUpdates = Select(request.SelectedUpdateKeys, preview.ConflictKeys, "selectedUpdateKeys");
        var uploaded = document.Features.ToDictionary(feature => feature.Key, StringComparer.OrdinalIgnoreCase);
        var candidate = target == null ? new CatalogDocument() : CatalogJson.Parse(CatalogJson.Serialize(target.Document));
        var current = candidate.Features.ToDictionary(feature => feature.Key, StringComparer.OrdinalIgnoreCase);
        candidate.Features.AddRange(selectedAdds.Select(key => uploaded[key]));
        foreach (var key in selectedUpdates)
        {
            if (!string.Equals(current[key].Key, uploaded[key].Key, StringComparison.Ordinal))
                throw Validation("selectedUpdateKeys", $"'{key}' differs only in casing from an existing immutable key.");
            candidate.Features[candidate.Features.IndexOf(current[key])] = uploaded[key];
        }
        foreach (var context in document.Contexts)
        {
            var retained = candidate.Contexts.SingleOrDefault(item => string.Equals(item.Kind, context.Kind, StringComparison.OrdinalIgnoreCase));
            if (retained == null) candidate.Contexts.Add(context);
            else retained.Properties.AddRange(context.Properties.Where(property => !retained.Properties.Any(item => string.Equals(item.Name, property.Name, StringComparison.OrdinalIgnoreCase))));
        }

        var write = await _editor.TryWriteAsync(candidate, request.ExpectedRevision, cancellationToken).ConfigureAwait(false);
        return new EmbeddedImportApplyResult(write.Status, write.Snapshot, write.Status == CatalogWriteStatus.Written ? candidate : null);
    }

    private CatalogDocument ParseCanonical(string payload)
    {
        if (Encoding.UTF8.GetByteCount(payload) > _options.MaxCatalogBytes)
            throw Validation("payload", "The catalog exceeds the configured maximum size.");
        var document = CatalogJson.Parse(payload);
        if (Encoding.UTF8.GetByteCount(CatalogJson.Serialize(document)) > _options.MaxCatalogBytes)
            throw Validation("payload", "The canonical catalog exceeds the configured maximum size.");
        return document;
    }

    private static IReadOnlyList<string> Select(IEnumerable<string>? selected, IReadOnlyList<string> allowed, string field)
    {
        var values = (selected ?? []).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        foreach (var value in values)
            if (string.IsNullOrEmpty(value) || !allowed.Contains(value, StringComparer.OrdinalIgnoreCase))
                throw Validation(field, "A selected key was not available in the import preview.");
        return values;
    }

    private static CatalogValidationException Validation(string path, string message) => new([new CatalogValidationError(path, message)]);
    private static string Fingerprint(string payload) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
    private static bool FixedTimeFingerprintEquals(string left, string right)
    {
        if (string.IsNullOrEmpty(right)) return false;
        try { return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(left), Convert.FromHexString(right)); }
        catch (FormatException) { return false; }
    }

    private static bool FeaturesEqual(CatalogFeature left, CatalogFeature right) =>
        string.Equals(left.Key, right.Key, StringComparison.Ordinal) && string.Equals(left.Name, right.Name, StringComparison.Ordinal) && string.Equals(left.Description, right.Description, StringComparison.Ordinal) && string.Equals(left.Category ?? string.Empty, right.Category ?? string.Empty, StringComparison.Ordinal) && left.Enabled == right.Enabled && left.RequirementType == right.RequirementType && left.ContextRequirementType == right.ContextRequirementType && string.Equals(left.ContextKind, right.ContextKind, StringComparison.Ordinal) && left.Tags.OrderBy(tag => tag, StringComparer.Ordinal).SequenceEqual(right.Tags.OrderBy(tag => tag, StringComparer.Ordinal), StringComparer.Ordinal) && left.Rules.Count == right.Rules.Count && left.Rules.Zip(right.Rules, (first, second) => string.Equals(first.Name, second.Name, StringComparison.Ordinal) && first.Parameters.OrderBy(pair => pair.Key, StringComparer.Ordinal).SequenceEqual(second.Parameters.OrderBy(pair => pair.Key, StringComparer.Ordinal))).All(equal => equal);

    private static bool ContextsConflict(CatalogContextSchema left, CatalogContextSchema right) =>
        !string.Equals(left.Kind, right.Kind, StringComparison.Ordinal) ||
        !string.Equals(left.KeyPropertyName, right.KeyPropertyName, StringComparison.Ordinal) ||
        right.Properties.Any(property => left.Properties.Any(existing =>
            string.Equals(existing.Name, property.Name, StringComparison.OrdinalIgnoreCase) &&
            (!string.Equals(existing.Name, property.Name, StringComparison.Ordinal) || !string.Equals(existing.Type, property.Type, StringComparison.Ordinal))));
}

public sealed record EmbeddedImportPreview(string CanonicalPayload, string Fingerprint, string? ExpectedRevision, IReadOnlyList<string> AddKeys, IReadOnlyList<string> IdenticalKeys, IReadOnlyList<string> ConflictKeys, IReadOnlyList<string> ContextConflictKinds);
public sealed record EmbeddedImportApplyRequest(string CanonicalPayload, string Fingerprint, string? ExpectedRevision, IEnumerable<string>? SelectedAddKeys, IEnumerable<string>? SelectedUpdateKeys);
public sealed record EmbeddedImportApplyResult(CatalogWriteStatus Status, CatalogSnapshot? Snapshot, CatalogDocument? CommittedDocument);
