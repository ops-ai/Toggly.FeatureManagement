using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.Extensions.Options;
using System.Security.Cryptography;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Embedded;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Server-rendered feature catalog pages for one embedded application.</summary>
[ServiceFilter(typeof(TogglyDashboardAccessFilter))]
[ServiceFilter(typeof(TogglyDashboardNoStoreFilter))]
public sealed class TogglyDashboardController : Controller
{
    private readonly EmbeddedCatalogEditor _editor;
    private readonly EmbeddedCatalogCoordinator _coordinator;
    private readonly EmbeddedContextSchemaProvider _contextSchemas;
    private readonly IAntiforgery _antiforgery;
    private readonly TogglyEmbeddedOptions _options;

    /// <summary>Creates the dashboard controller.</summary>
    public TogglyDashboardController(EmbeddedCatalogEditor editor, EmbeddedCatalogCoordinator coordinator, EmbeddedContextSchemaProvider contextSchemas, IAntiforgery antiforgery, IOptions<TogglyEmbeddedOptions> options)
    {
        _editor = editor;
        _coordinator = coordinator;
        _contextSchemas = contextSchemas;
        _antiforgery = antiforgery;
        _options = options.Value;
    }

    /// <summary>Lists the catalog features.</summary>
    public async Task<IActionResult> Index(string? search, string? state, string? tag, int page = 1)
    {
        try
        {
            var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            return View(new DashboardFeatureListViewModel
            {
                CatalogExists = snapshot != null,
                Revision = snapshot?.Revision ?? string.Empty,
                Features = FilterFeatures(snapshot?.Document.Features ?? [], search, state, tag),
                ReadOnly = _coordinator.Diagnostics.ReadOnly,
                Search = search ?? string.Empty,
                State = state ?? string.Empty,
                Tag = tag ?? string.Empty,
                Page = Math.Max(page, 1),
                Tags = snapshot?.Document.Features.SelectMany(feature => feature.Tags).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToList() ?? []
            });
        }
        catch (Exception)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable.");
        }
    }

    /// <summary>Shows a disabled-feature creation form.</summary>
    public async Task<IActionResult> New()
    {
        try
        {
            var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            return snapshot == null ? NotFound() : View(new DashboardFeatureInput { IsNew = true, ExpectedRevision = snapshot.Revision });
        }
        catch (Exception)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable.");
        }
    }

    /// <summary>Creates a disabled feature when the catalog has not changed.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(DashboardFeatureInput input, string? command, int? removeRuleIndex)
    {
        if (ApplyRuleEditorCommand(input, command, removeRuleIndex)) return View("New", input);
        input.Enabled = false;
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable."); }
        if (snapshot == null) return NotFound();
        if (!ModelState.IsValid) return ValidationView("New", input);
        if (snapshot.Document.Features.Any(feature => string.Equals(feature.Key, input.Key.Trim(), StringComparison.OrdinalIgnoreCase)))
        {
            ModelState.AddModelError(nameof(input.Key), "A feature with this key already exists.");
            return ValidationView("New", input);
        }

        snapshot.Document.Features.Add(input.ToFeature());
        return await WriteOrConflictAsync(snapshot.Document, input.ExpectedRevision, "Index", input).ConfigureAwait(false);
    }

    /// <summary>Shows the editor for an existing feature.</summary>
    public async Task<IActionResult> Edit(string key)
    {
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable."); }
        var feature = snapshot?.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, key, StringComparison.Ordinal));
        return feature == null || snapshot == null ? NotFound() : View(DashboardFeatureInput.FromFeature(feature, snapshot.Revision));
    }

    /// <summary>Saves editable metadata while preserving retained targeting rules.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Save(DashboardFeatureInput input, string? command, int? removeRuleIndex)
    {
        if (ApplyRuleEditorCommand(input, command, removeRuleIndex)) return View("Edit", input);
        if (!ModelState.IsValid) return ValidationView("Edit", input);
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable."); }
        var existing = snapshot?.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, input.Key, StringComparison.Ordinal));
        if (snapshot == null || existing == null) return NotFound();
        snapshot.Document.Features[snapshot.Document.Features.IndexOf(existing)] = input.ToFeature(existing);
        return await WriteOrConflictAsync(snapshot.Document, input.ExpectedRevision, "Edit", input).ConfigureAwait(false);
    }

    /// <summary>Sets an explicit enabled state without deleting rules.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> State(string key, bool enabled, string expectedRevision)
    {
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable."); }
        var feature = snapshot?.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, key, StringComparison.Ordinal));
        if (snapshot == null || feature == null) return NotFound();
        feature.Enabled = enabled;
        return await WriteOrConflictAsync(snapshot.Document, expectedRevision, "Index", null).ConfigureAwait(false);
    }

    /// <summary>Shows a destructive-action confirmation page.</summary>
    public async Task<IActionResult> DeleteConfirm(string key)
    {
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable."); }
        var feature = snapshot?.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, key, StringComparison.Ordinal));
        if (snapshot == null || feature == null) return NotFound();
        return View(DashboardFeatureInput.FromFeature(feature, snapshot.Revision));
    }

    /// <summary>Deletes a feature after confirmation.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Delete(string key, string expectedRevision)
    {
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable."); }
        if (snapshot == null) return NotFound();
        var feature = snapshot.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, key, StringComparison.Ordinal));
        if (feature == null) return NotFound();
        snapshot.Document.Features.Remove(feature);
        return await WriteOrConflictAsync(snapshot.Document, expectedRevision, "Index", null).ConfigureAwait(false);
    }

    /// <summary>Explicitly creates the initially empty catalog if it is absent.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Initialize()
    {
        return await WriteOrConflictAsync(new CatalogDocument(), null, "Index", null).ConfigureAwait(false);
    }

    /// <summary>Shows host registered and catalog retained context schemas.</summary>
    public async Task<IActionResult> Contexts()
    {
        try
        {
            var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            return View(new DashboardContextsViewModel { Registered = _contextSchemas.GetRegisteredSchemas(), Retained = snapshot?.Document.Contexts ?? [] });
        }
        catch (Exception)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable.");
        }
    }

    /// <summary>Shows local runtime storage diagnostics.</summary>
    public IActionResult Storage() => View(_coordinator.Diagnostics);

    /// <summary>Downloads the current authoritative portable catalog.</summary>
    public async Task<IActionResult> Export()
    {
        try
        {
            var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            return snapshot == null ? NotFound() : File(System.Text.Encoding.UTF8.GetBytes(CatalogJson.Serialize(snapshot.Document)), "application/json", "toggly-catalog.json");
        }
        catch (Exception) { return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable."); }
    }

    /// <summary>Shows the local catalog import entry point.</summary>
    public IActionResult Import() => View();

    /// <summary>Validates an uploaded catalog and previews additive changes without writing.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> ImportPreview(IFormFile? catalog)
    {
        if (catalog == null || catalog.Length == 0) return BadRequest("Select a catalog JSON file.");
        if (catalog.Length > _options.MaxCatalogBytes) return BadRequest("The catalog exceeds the configured maximum size.");
        try
        {
            using var reader = new StreamReader(catalog.OpenReadStream());
            var document = CatalogJson.Parse(await reader.ReadToEndAsync(HttpContext.RequestAborted).ConfigureAwait(false));
            var target = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            if (target == null) return NotFound();
            var existing = target.Document.Features.ToDictionary(feature => feature.Key, StringComparer.OrdinalIgnoreCase);
            var payload = CatalogJson.Serialize(document);
            return View(new DashboardImportPreviewViewModel
            {
                Payload = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payload)),
                Fingerprint = ComputeFingerprint(payload),
                ExpectedRevision = target.Revision,
                AddKeys = document.Features.Where(feature => !existing.ContainsKey(feature.Key)).Select(feature => feature.Key).OrderBy(key => key, StringComparer.Ordinal).ToList(),
                IdenticalKeys = document.Features.Where(feature => existing.TryGetValue(feature.Key, out var current) && FeaturesEqual(current, feature)).Select(feature => feature.Key).OrderBy(key => key, StringComparer.Ordinal).ToList(),
                ConflictKeys = document.Features.Where(feature => existing.TryGetValue(feature.Key, out var current) && !FeaturesEqual(current, feature)).Select(feature => feature.Key).OrderBy(key => key, StringComparer.Ordinal).ToList()
            });
        }
        catch (CatalogFormatException exception) { return BadRequest(exception.Message); }
        catch (CatalogValidationException exception) { return BadRequest(exception.Message); }
        catch (Exception) { return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable."); }
    }

    /// <summary>Applies the additive selections shown in a validated import preview.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> ImportApply(string payload, string fingerprint, string expectedRevision, string[]? selectedAddKeys, string[]? selectedUpdateKeys)
    {
        try
        {
            if (payload.Length > MaximumBase64Length(_options.MaxCatalogBytes)) return BadRequest("The catalog exceeds the configured maximum size.");
            var payloadBytes = Convert.FromBase64String(payload);
            if (payloadBytes.LongLength > _options.MaxCatalogBytes) return BadRequest("The catalog exceeds the configured maximum size.");
            var document = CatalogJson.Parse(System.Text.Encoding.UTF8.GetString(payloadBytes));
            var canonicalPayload = CatalogJson.Serialize(document);
            if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(ComputeFingerprint(canonicalPayload)), Convert.FromHexString(fingerprint))) return BadRequest("The import preview is invalid. Create a new preview.");
            var target = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            if (target == null) return NotFound();
            var uploaded = document.Features.ToDictionary(feature => feature.Key, StringComparer.OrdinalIgnoreCase);
            var existing = target.Document.Features.ToDictionary(feature => feature.Key, StringComparer.OrdinalIgnoreCase);
            var additions = (selectedAddKeys ?? []).Where(uploaded.ContainsKey).Where(key => !existing.ContainsKey(key)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var updates = (selectedUpdateKeys ?? []).Where(uploaded.ContainsKey).Where(existing.ContainsKey).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            target.Document.Features.AddRange(additions.Select(key => uploaded[key]));
            foreach (var key in updates)
            {
                var index = target.Document.Features.IndexOf(existing[key]);
                target.Document.Features[index] = uploaded[key];
            }
            foreach (var context in document.Contexts)
            {
                var current = target.Document.Contexts.SingleOrDefault(candidate => string.Equals(candidate.Kind, context.Kind, StringComparison.OrdinalIgnoreCase));
                if (current == null) target.Document.Contexts.Add(context);
                else if (!ContextsEqual(current, context)) return BadRequest($"Context '{context.Kind}' conflicts with the current catalog.");
            }
            return await WriteOrConflictAsync(target.Document, expectedRevision, "Index", null).ConfigureAwait(false);
        }
        catch (FormatException) { return BadRequest("The import preview payload is invalid. Create a new preview."); }
        catch (CatalogFormatException exception) { return BadRequest(exception.Message); }
        catch (CatalogValidationException exception) { return BadRequest(exception.Message); }
        catch (Exception) { return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable."); }
    }

    /// <summary>Shows cloud migration instructions without making network requests.</summary>
    public IActionResult Cloud() => View();

    public override void OnActionExecuting(Microsoft.AspNetCore.Mvc.Filters.ActionExecutingContext context)
    {
        var metadata = context.HttpContext.GetEndpoint()?.Metadata.GetMetadata<TogglyDashboardEndpointMetadata>();
        ViewData["DashboardMount"] = metadata?.MountPath ?? string.Empty;
        ViewData["ApplicationName"] = metadata?.ApplicationName ?? "Application";
        ViewData["AntiforgeryToken"] = _antiforgery.GetAndStoreTokens(context.HttpContext).RequestToken ?? string.Empty;
        context.HttpContext.Response.Headers.CacheControl = "private, no-store";
        base.OnActionExecuting(context);
    }

    private async Task<IActionResult> WriteOrConflictAsync(CatalogDocument document, string? revision, string successAction, DashboardFeatureInput? input)
    {
        try
        {
            var result = await _editor.TryWriteAsync(document, revision, HttpContext.RequestAborted).ConfigureAwait(false);
            if (result.Status == CatalogWriteStatus.Written)
            {
                var mount = HttpContext.GetEndpoint()?.Metadata.GetMetadata<TogglyDashboardEndpointMetadata>()?.MountPath ?? string.Empty;
                var target = successAction == "Edit" && input != null
                    ? $"{HttpContext.Request.PathBase}{mount}/features/edit?key={Uri.EscapeDataString(input.Key)}"
                    : $"{HttpContext.Request.PathBase}{mount}/";
                Response.StatusCode = StatusCodes.Status303SeeOther;
                Response.Headers.Location = target;
                return new EmptyResult();
            }
            Response.StatusCode = StatusCodes.Status409Conflict;
            return View("Conflict", input ?? new DashboardFeatureInput { ExpectedRevision = revision ?? string.Empty });
        }
        catch (CatalogValidationException exception)
        {
            foreach (var error in exception.Errors) ModelState.AddModelError(error.Path, error.Message);
            Response.StatusCode = StatusCodes.Status400BadRequest;
            return View(input == null ? "Index" : "Edit", input);
        }
        catch (InvalidOperationException)
        {
            return StatusCode(StatusCodes.Status403Forbidden);
        }
        catch (Exception)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable.");
        }
    }

    private ViewResult ValidationView(string viewName, DashboardFeatureInput input)
    {
        Response.StatusCode = StatusCodes.Status400BadRequest;
        return View(viewName, input);
    }

    private static IReadOnlyList<CatalogFeature> FilterFeatures(IReadOnlyList<CatalogFeature> features, string? search, string? state, string? tag)
    {
        IEnumerable<CatalogFeature> query = features;
        if (!string.IsNullOrWhiteSpace(search))
        {
            query = query.Where(feature => feature.Name.Contains(search, StringComparison.OrdinalIgnoreCase) || feature.Key.Contains(search, StringComparison.OrdinalIgnoreCase) || feature.Description.Contains(search, StringComparison.OrdinalIgnoreCase) || feature.Tags.Any(value => value.Contains(search, StringComparison.OrdinalIgnoreCase)));
        }
        if (string.Equals(state, "enabled", StringComparison.OrdinalIgnoreCase)) query = query.Where(feature => feature.Enabled);
        if (string.Equals(state, "disabled", StringComparison.OrdinalIgnoreCase)) query = query.Where(feature => !feature.Enabled);
        if (!string.IsNullOrWhiteSpace(tag)) query = query.Where(feature => feature.Tags.Contains(tag, StringComparer.OrdinalIgnoreCase));
        return query.OrderBy(feature => feature.Name, StringComparer.OrdinalIgnoreCase).ThenBy(feature => feature.Key, StringComparer.Ordinal).ToList();
    }

    private static bool ApplyRuleEditorCommand(DashboardFeatureInput input, string? command, int? removeRuleIndex)
    {
        if (string.Equals(command, "add-rule", StringComparison.Ordinal))
        {
            input.Rules.Add(new DashboardRuleInput());
            return true;
        }
        if (removeRuleIndex is >= 0 and < int.MaxValue && removeRuleIndex.Value < input.Rules.Count)
        {
            input.Rules.RemoveAt(removeRuleIndex.Value);
            return true;
        }
        return false;
    }

    private static string ComputeFingerprint(string canonicalPayload) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(canonicalPayload)));

    private static long MaximumBase64Length(long maximumBytes) => checked(((maximumBytes + 2) / 3) * 4);

    private static bool FeaturesEqual(CatalogFeature left, CatalogFeature right)
    {
        return string.Equals(left.Key, right.Key, StringComparison.Ordinal) && string.Equals(left.Name, right.Name, StringComparison.Ordinal) &&
            string.Equals(left.Description, right.Description, StringComparison.Ordinal) && left.Enabled == right.Enabled &&
            left.RequirementType == right.RequirementType && left.ContextRequirementType == right.ContextRequirementType &&
            string.Equals(left.ContextKind, right.ContextKind, StringComparison.Ordinal) && left.Tags.OrderBy(tag => tag, StringComparer.Ordinal).SequenceEqual(right.Tags.OrderBy(tag => tag, StringComparer.Ordinal), StringComparer.Ordinal) &&
            left.Rules.Count == right.Rules.Count && left.Rules.Zip(right.Rules, (first, second) => string.Equals(first.Name, second.Name, StringComparison.Ordinal) && first.Parameters.OrderBy(pair => pair.Key, StringComparer.Ordinal).SequenceEqual(second.Parameters.OrderBy(pair => pair.Key, StringComparer.Ordinal))).All(equal => equal);
    }

    private static bool ContextsEqual(CatalogContextSchema left, CatalogContextSchema right)
    {
        return string.Equals(left.Kind, right.Kind, StringComparison.Ordinal) && string.Equals(left.KeyPropertyName, right.KeyPropertyName, StringComparison.Ordinal) &&
            left.Properties.Count == right.Properties.Count && left.Properties.OrderBy(property => property.Name, StringComparer.Ordinal).Zip(right.Properties.OrderBy(property => property.Name, StringComparer.Ordinal), (first, second) => string.Equals(first.Name, second.Name, StringComparison.Ordinal) && string.Equals(first.Type, second.Type, StringComparison.Ordinal)).All(equal => equal);
    }
}
