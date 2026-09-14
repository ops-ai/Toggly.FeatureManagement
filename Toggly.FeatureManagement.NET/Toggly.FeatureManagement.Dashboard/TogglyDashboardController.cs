using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.Extensions.Options;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Embedded;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Server-rendered feature catalog pages for one embedded application.</summary>
[ServiceFilter(typeof(TogglyDashboardAccessFilter))]
[ServiceFilter(typeof(TogglyDashboardNoStoreFilter))]
[ServiceFilter(typeof(TogglyDashboardFormLimitsFilter), Order = -1000)]
[Area("TogglyDashboard")]
public sealed class TogglyDashboardController : Controller
{
    private readonly EmbeddedCatalogEditor _editor;
    private readonly EmbeddedCatalogCoordinator _coordinator;
    private readonly EmbeddedContextSchemaProvider _contextSchemas;
    private readonly IAntiforgery _antiforgery;
    private readonly TogglyEmbeddedOptions _options;
    private readonly EmbeddedImportService _importService;

    /// <summary>Creates the dashboard controller.</summary>
    public TogglyDashboardController(EmbeddedCatalogEditor editor, EmbeddedCatalogCoordinator coordinator, EmbeddedContextSchemaProvider contextSchemas, IAntiforgery antiforgery, IOptions<TogglyEmbeddedOptions> options, EmbeddedImportService importService)
    {
        _editor = editor;
        _coordinator = coordinator;
        _contextSchemas = contextSchemas;
        _antiforgery = antiforgery;
        _options = options.Value;
        _importService = importService;
    }

    private const string IndexView = "Index";
    private const string EditView = "Edit";

    private ObjectResult CatalogUnavailable() =>
        StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable.");

    /// <summary>Lists the catalog features.</summary>
    public async Task<IActionResult> Index(string? search, string? tag, string? category, string? sort, string? expand)
    {
        try
        {
            var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            return View(BuildList(snapshot, search, tag, category, sort, expand, null));
        }
        catch (Exception)
        {
            return CatalogUnavailable();
        }
    }

    /// <summary>Shows a disabled-feature creation form.</summary>
    public async Task<IActionResult> New()
    {
        try
        {
            var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            SetContextKinds(snapshot);
            return snapshot == null ? NotFound() : View(new DashboardFeatureInput { IsNew = true, ExpectedRevision = snapshot.Revision });
        }
        catch (Exception)
        {
            return CatalogUnavailable();
        }
    }

    /// <summary>Creates a disabled feature when the catalog has not changed.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(DashboardFeatureInput input)
    {
        input.IsNew = true;
        input.Enabled = false;
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return CatalogUnavailable(); }
        if (snapshot == null) return NotFound();
        if (!ModelState.IsValid) return ValidationView("New", input);
        if (snapshot.Document.Features.Any(feature => string.Equals(feature.Key, input.Key.Trim(), StringComparison.OrdinalIgnoreCase)))
        {
            ModelState.AddModelError(nameof(input.Key), "A feature with this key already exists.");
            return ValidationView("New", input);
        }

        snapshot.Document.Features.Add(input.ToNewFeature());
        return await WriteOrConflictAsync(snapshot.Document, input.ExpectedRevision, IndexView, input).ConfigureAwait(false);
    }

    /// <summary>Shows the editor for an existing feature.</summary>
    public async Task<IActionResult> Edit(string key)
    {
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return CatalogUnavailable(); }
        var feature = snapshot?.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, key, StringComparison.Ordinal));
        SetContextKinds(snapshot);
        if (feature == null) return NotFound();
        return View(DashboardFeatureInput.FromFeature(feature, snapshot!.Revision));
    }

    /// <summary>Saves editable metadata while preserving retained targeting rules.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Save(DashboardFeatureInput input)
    {
        input.IsNew = false;
        if (!ModelState.IsValid) return ValidationView(EditView, input);
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return CatalogUnavailable(); }
        var existing = snapshot?.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, input.Key, StringComparison.Ordinal));
        if (snapshot == null || existing == null) return NotFound();
        input.ApplyMetadata(existing);
        return await WriteOrConflictAsync(snapshot.Document, input.ExpectedRevision, EditView, input).ConfigureAwait(false);
    }

    /// <summary>Persists the expanded conditions draft for one feature.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Conditions(DashboardFeatureInput input, string? command, int? removeRuleIndex, string? newRuleName, [Bind(Prefix = "")] DashboardFeatureListFilter filter)
    {
        input.IsNew = false;
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return CatalogUnavailable(); }
        var existing = snapshot?.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, input.Key, StringComparison.Ordinal));
        if (snapshot == null || existing == null) return NotFound();
        SetContextKinds(snapshot);
        input.Name = existing.Name;
        input.ContextKind = existing.ContextKind;
        ModelState.Remove(nameof(DashboardFeatureInput.Name));
        ModelState.Remove(nameof(DashboardFeatureInput.Description));
        ModelState.Remove(nameof(DashboardFeatureInput.Category));
        ModelState.Remove(nameof(DashboardFeatureInput.Tags));
        if (ApplyRuleEditorCommand(input, command, removeRuleIndex, newRuleName))
            return Response.StatusCode == StatusCodes.Status400BadRequest
                ? ConditionsView(snapshot, input, filter)
                : View(IndexView, BuildList(snapshot, filter.Search, filter.Tag, filter.Category, filter.Sort, input.Key, input));
        if (input.Enabled == null)
            return BadRequest("A feature key, expected revision, and explicit true or false enabled state are required.");
        if (!ModelState.IsValid) return ConditionsView(snapshot, input, filter);
        if (input.Enabled == true && input.Rules.Count == 0)
        {
            ModelState.AddModelError(nameof(input.Rules), "Add at least one user filter or entity condition before saving an enabled feature.");
            return ConditionsView(snapshot, input, filter);
        }
        input.ApplyConditions(existing);
        return await WriteOrConflictAsync(snapshot.Document, input.ExpectedRevision, IndexView, input).ConfigureAwait(false);
    }

    /// <summary>Shows a destructive-action confirmation page.</summary>
    public async Task<IActionResult> DeleteConfirm(string key)
    {
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return CatalogUnavailable(); }
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
        catch (Exception) { return CatalogUnavailable(); }
        if (snapshot == null) return NotFound();
        var feature = snapshot.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, key, StringComparison.Ordinal));
        if (feature == null) return NotFound();
        snapshot.Document.Features.Remove(feature);
        return await WriteOrConflictAsync(snapshot.Document, expectedRevision, IndexView, null).ConfigureAwait(false);
    }

    /// <summary>Explicitly creates the initially empty catalog if it is absent.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Initialize()
    {
        return await WriteOrConflictAsync(new CatalogDocument(), null, IndexView, null).ConfigureAwait(false);
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
            return CatalogUnavailable();
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
        catch (Exception) { return CatalogUnavailable(); }
    }

    /// <summary>Lists reusable identifier bags for Targeting slots.</summary>
    public async Task<IActionResult> Lists()
    {
        try
        {
            var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            return snapshot == null ? NotFound() : View(ListIndex(snapshot, null));
        }
        catch (Exception)
        {
            return CatalogUnavailable();
        }
    }

    /// <summary>Shows a create-list form.</summary>
    public async Task<IActionResult> NewList()
    {
        try
        {
            var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            return snapshot == null ? NotFound() : View("ListEdit", new DashboardListInput { IsNew = true, ExpectedRevision = snapshot.Revision });
        }
        catch (Exception)
        {
            return CatalogUnavailable();
        }
    }

    /// <summary>Creates a named identifier list.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> CreateList(DashboardListInput input)
    {
        input.IsNew = true;
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return CatalogUnavailable(); }
        if (snapshot == null) return NotFound();
        if (!ModelState.IsValid) return ListValidation(input);
        if (snapshot.Document.Lists.Any(list => string.Equals(list.Key, input.Key.Trim(), StringComparison.OrdinalIgnoreCase)))
        {
            ModelState.AddModelError(nameof(input.Key), "A list with this key already exists.");
            return ListValidation(input);
        }

        snapshot.Document.Lists.Add(input.ToList());
        return await WriteListOrConflictAsync(snapshot.Document, input.ExpectedRevision, input).ConfigureAwait(false);
    }

    /// <summary>Shows an edit-list form.</summary>
    public async Task<IActionResult> EditList(string key)
    {
        try
        {
            var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            var list = snapshot?.Document.Lists.SingleOrDefault(candidate => string.Equals(candidate.Key, key, StringComparison.Ordinal));
            return snapshot == null || list == null ? NotFound() : View("ListEdit", DashboardListInput.FromList(list, snapshot.Revision));
        }
        catch (Exception)
        {
            return CatalogUnavailable();
        }
    }

    /// <summary>Saves list metadata and identifiers.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SaveList(DashboardListInput input)
    {
        input.IsNew = false;
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return CatalogUnavailable(); }
        var existing = snapshot?.Document.Lists.SingleOrDefault(candidate => string.Equals(candidate.Key, input.Key, StringComparison.Ordinal));
        if (snapshot == null || existing == null) return NotFound();
        if (!ModelState.IsValid) return ListValidation(input);
        input.Apply(existing);
        return await WriteListOrConflictAsync(snapshot.Document, input.ExpectedRevision, input).ConfigureAwait(false);
    }

    /// <summary>Shows a destructive-action confirmation page for a list.</summary>
    public async Task<IActionResult> DeleteListConfirm(string key)
    {
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return CatalogUnavailable(); }
        var list = snapshot?.Document.Lists.SingleOrDefault(candidate => string.Equals(candidate.Key, key, StringComparison.Ordinal));
        if (snapshot == null || list == null) return NotFound();
        var users = FeaturesUsingList(snapshot.Document, list.Key);
        if (users.Count > 0)
        {
            ModelState.AddModelError("key", "This list is used by " + string.Join(", ", users.Select(feature => feature.Name + " (" + feature.Key + ")")) + ".");
            Response.StatusCode = StatusCodes.Status400BadRequest;
            return View("Lists", ListIndex(snapshot, list.Key));
        }

        return View("ListDelete", DashboardListInput.FromList(list, snapshot.Revision));
    }

    /// <summary>Deletes a list after confirmation when no Targeting slot references it.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeleteList(string key, string expectedRevision)
    {
        CatalogSnapshot? snapshot;
        try { snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false); }
        catch (Exception) { return CatalogUnavailable(); }
        if (snapshot == null) return NotFound();
        var list = snapshot.Document.Lists.SingleOrDefault(candidate => string.Equals(candidate.Key, key, StringComparison.Ordinal));
        if (list == null) return NotFound();
        var users = FeaturesUsingList(snapshot.Document, list.Key);
        if (users.Count > 0)
        {
            ModelState.AddModelError("key", "This list is used by " + string.Join(", ", users.Select(feature => feature.Name + " (" + feature.Key + ")")) + ".");
            Response.StatusCode = StatusCodes.Status400BadRequest;
            return View("Lists", ListIndex(snapshot, key));
        }

        snapshot.Document.Lists.Remove(list);
        return await WriteListOrConflictAsync(snapshot.Document, expectedRevision, DashboardListInput.FromList(list, expectedRevision)).ConfigureAwait(false);
    }

    /// <summary>Shows the local catalog import entry point.</summary>
    public IActionResult Import() => View();

    /// <summary>Validates an uploaded catalog and previews additive changes without writing.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> ImportPreview(IFormFile? catalog)
    {
        if (catalog == null || catalog.Length == 0) return ImportValidation("Select a catalog JSON file.");
        if (catalog.Length > _options.MaxCatalogBytes) return ImportValidation("The catalog exceeds the configured maximum size.");
        try
        {
            using var reader = new StreamReader(catalog.OpenReadStream());
            var preview = await _importService.PreviewAsync(await reader.ReadToEndAsync(HttpContext.RequestAborted).ConfigureAwait(false), HttpContext.RequestAborted).ConfigureAwait(false);
            return View(new DashboardImportPreviewViewModel
            {
                Payload = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(preview.CanonicalPayload)),
                Fingerprint = preview.Fingerprint,
                ExpectedRevision = preview.ExpectedRevision,
                AddKeys = preview.AddKeys,
                IdenticalKeys = preview.IdenticalKeys,
                ConflictKeys = preview.ConflictKeys,
                ContextConflictKinds = preview.ContextConflictKinds
            });
        }
        catch (CatalogFormatException exception) { return ImportValidation(exception.Message); }
        catch (CatalogValidationException exception) { return ImportValidation(exception.Message, exception.Errors); }
        catch (Exception) { return CatalogUnavailable(); }
    }

    /// <summary>Applies the additive selections shown in a validated import preview.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> ImportApply(string payload, string fingerprint, string? expectedRevision, string[]? selectedAddKeys, string[]? selectedUpdateKeys)
    {
        if (!ModelState.IsValid || string.IsNullOrEmpty(payload) || string.IsNullOrEmpty(fingerprint)) return ImportValidation("The import preview is incomplete. Create a new preview.");
        try
        {
            if (payload.Length > MaximumBase64Length(_options.MaxCatalogBytes)) return ImportValidation("The catalog exceeds the configured maximum size.");
            var payloadBytes = Convert.FromBase64String(payload);
            if (payloadBytes.LongLength > _options.MaxCatalogBytes) return ImportValidation("The catalog exceeds the configured maximum size.");
            var result = await _importService.ApplyAsync(new EmbeddedImportApplyRequest(System.Text.Encoding.UTF8.GetString(payloadBytes), fingerprint, expectedRevision, selectedAddKeys, selectedUpdateKeys), HttpContext.RequestAborted).ConfigureAwait(false);
            if (result.Status == CatalogWriteStatus.Conflict)
            {
                Response.StatusCode = StatusCodes.Status409Conflict;
                return View("Conflict", new DashboardFeatureInput { IsNew = false, ExpectedRevision = expectedRevision ?? string.Empty });
            }
            var mount = HttpContext.GetEndpoint()?.Metadata.GetMetadata<TogglyDashboardEndpointMetadata>()?.MountPath ?? string.Empty;
            Response.StatusCode = StatusCodes.Status303SeeOther;
            Response.Headers.Location = $"{HttpContext.Request.PathBase}{mount}/";
            return new EmptyResult();
        }
        catch (FormatException) { return ImportValidation("The import preview payload is invalid. Create a new preview."); }
        catch (CatalogFormatException exception) { return ImportValidation(exception.Message); }
        catch (CatalogValidationException exception) { return ImportValidation(exception.Message, exception.Errors); }
        catch (Exception) { return CatalogUnavailable(); }
    }

    /// <summary>Shows cloud migration instructions without making network requests.</summary>
    public IActionResult Cloud() => View();

    public override void OnActionExecuting(Microsoft.AspNetCore.Mvc.Filters.ActionExecutingContext context)
    {
        var metadata = context.HttpContext.GetEndpoint()?.Metadata.GetMetadata<TogglyDashboardEndpointMetadata>();
        ViewData["DashboardMount"] = metadata?.MountPath ?? string.Empty;
        ViewData["ApplicationName"] = metadata?.ApplicationName ?? "Application";
        ViewData["ReadOnly"] = WritesUnavailable;
        ViewData["ActiveTab"] = context.RouteData.Values["action"]?.ToString() switch
        {
            "Contexts" => "contexts",
            "Storage" => "storage",
            "Lists" or "NewList" or "EditList" or "DeleteListConfirm" => "lists",
            "Import" or "ImportPreview" or "ImportApply" => "import",
            "Cloud" => "cloud",
            _ => "features"
        };
        SetContextKinds(null);
        ViewData["AntiforgeryToken"] = _antiforgery.GetAndStoreTokens(context.HttpContext).RequestToken ?? string.Empty;
        context.HttpContext.Response.Headers.CacheControl = "private, no-store";
        base.OnActionExecuting(context);
    }

    private void SetContextKinds(CatalogSnapshot? snapshot) => ViewData["ContextKinds"] =
        _contextSchemas.GetRegisteredSchemas().Select(schema => schema.Kind)
            .Concat(snapshot?.Document.Contexts.Select(schema => schema.Kind) ?? [])
            .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(kind => kind, StringComparer.Ordinal).ToArray();

    private bool WritesUnavailable => _coordinator.Diagnostics.ReadOnly ||
        _coordinator.Diagnostics.StorageState is EmbeddedStorageState.Stale or EmbeddedStorageState.Unavailable;

    private async Task<IActionResult> WriteOrConflictAsync(CatalogDocument document, string? revision, string successAction, DashboardFeatureInput? input)
    {
        try
        {
            var result = await _editor.TryWriteAsync(document, revision, HttpContext.RequestAborted).ConfigureAwait(false);
            if (result.Status == CatalogWriteStatus.Written)
                return RedirectAfterWrite(successAction, input);
            Response.StatusCode = StatusCodes.Status409Conflict;
            ViewData["CurrentFeature"] = result.Snapshot?.Document.Features.FirstOrDefault(feature => string.Equals(feature.Key, input?.Key, StringComparison.OrdinalIgnoreCase));
            return View("Conflict", input ?? new DashboardFeatureInput { IsNew = false, ExpectedRevision = revision ?? string.Empty });
        }
        catch (CatalogValidationException exception)
        {
            foreach (var error in exception.Errors) ModelState.AddModelError(error.Path, error.Message);
            Response.StatusCode = StatusCodes.Status400BadRequest;
            return await WriteValidationViewAsync(successAction, input).ConfigureAwait(false);
        }
        catch (InvalidOperationException)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable for writes.");
        }
        catch (Exception)
        {
            return CatalogUnavailable();
        }
    }

    private async Task<IActionResult> WriteListOrConflictAsync(CatalogDocument document, string? revision, DashboardListInput input)
    {
        try
        {
            var result = await _editor.TryWriteAsync(document, revision, HttpContext.RequestAborted).ConfigureAwait(false);
            if (result.Status == CatalogWriteStatus.Written)
            {
                var mount = HttpContext.GetEndpoint()?.Metadata.GetMetadata<TogglyDashboardEndpointMetadata>()?.MountPath ?? string.Empty;
                Response.StatusCode = StatusCodes.Status303SeeOther;
                Response.Headers.Location = $"{HttpContext.Request.PathBase}{mount}/lists";
                return new EmptyResult();
            }
            Response.StatusCode = StatusCodes.Status409Conflict;
            return View("Conflict", new DashboardFeatureInput { IsNew = false, ExpectedRevision = revision ?? string.Empty });
        }
        catch (CatalogValidationException exception)
        {
            foreach (var error in exception.Errors) ModelState.AddModelError(error.Path, error.Message);
            return ListValidation(input);
        }
        catch (InvalidOperationException)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable for writes.");
        }
        catch (Exception)
        {
            return CatalogUnavailable();
        }
    }

    private static readonly string[] TargetingListSlots =
        ["Audience.Users", "Audience.Groups", "Audience.Exclusion.Users", "Audience.Exclusion.Groups"];

    private static List<CatalogFeature> FeaturesUsingList(CatalogDocument document, string key) =>
        document.Features.Where(feature => feature.Rules.Any(rule =>
            string.Equals(rule.Name, DashboardRuleInput.Targeting, StringComparison.Ordinal) &&
            TargetingListSlots.Any(slot => rule.Parameters.TryGetValue(slot, out var linked) &&
                string.Equals(linked, key, StringComparison.OrdinalIgnoreCase)))).ToList();

    private DashboardListsViewModel ListIndex(CatalogSnapshot snapshot, string? blockedKey) => new()
    {
        Revision = snapshot.Revision,
        ReadOnly = WritesUnavailable,
        BlockedKey = blockedKey,
        Lists = snapshot.Document.Lists,
        Usage = snapshot.Document.Lists.ToDictionary(
            list => list.Key,
            list => FeaturesUsingList(snapshot.Document, list.Key).Count,
            StringComparer.Ordinal)
    };

    private ViewResult ListValidation(DashboardListInput input)
    {
        Response.StatusCode = StatusCodes.Status400BadRequest;
        return View("ListEdit", input);
    }

    private ViewResult ImportValidation(string message, IEnumerable<CatalogValidationError>? errors = null)
    {
        if (errors == null) ModelState.AddModelError("catalog", message);
        else foreach (var error in errors) ModelState.AddModelError(error.Path, error.Message);
        Response.StatusCode = StatusCodes.Status400BadRequest;
        return View("Import");
    }

    private EmptyResult RedirectAfterWrite(string successAction, DashboardFeatureInput? input)
    {
        var mount = HttpContext.GetEndpoint()?.Metadata.GetMetadata<TogglyDashboardEndpointMetadata>()?.MountPath ?? string.Empty;
        string target;
        if (successAction == EditView && input != null)
            target = $"{HttpContext.Request.PathBase}{mount}/features/edit?key={Uri.EscapeDataString(input.Key)}";
        else
            target = $"{HttpContext.Request.PathBase}{mount}/";
        Response.StatusCode = StatusCodes.Status303SeeOther;
        Response.Headers.Location = target;
        return new EmptyResult();
    }

    private async Task<IActionResult> WriteValidationViewAsync(string successAction, DashboardFeatureInput? input)
    {
        if (successAction == IndexView && input != null && !input.IsNew)
        {
            var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            return snapshot == null ? View("Validation", input) : ConditionsView(snapshot, input);
        }
        if (input == null) return View("Validation", input);
        if (input.IsNew) return View("New", input);
        return View(EditView, input);
    }

    private ViewResult ConditionsView(CatalogSnapshot snapshot, DashboardFeatureInput input, DashboardFeatureListFilter filter) =>
        ConditionsView(snapshot, input, filter.Search, filter.Tag, filter.Category, filter.Sort);

    private ViewResult ConditionsView(CatalogSnapshot snapshot, DashboardFeatureInput input, string? search = null, string? tag = null, string? category = null, string? sort = null)
    {
        Response.StatusCode = StatusCodes.Status400BadRequest;
        return View(IndexView, BuildList(snapshot, search, tag, category, sort, input.Key, input));
    }

    private DashboardFeatureListViewModel BuildList(CatalogSnapshot? snapshot, string? search, string? tag, string? category, string? sort, string? expand, DashboardFeatureInput? draft)
    {
        var all = snapshot?.Document.Features ?? [];
        return new DashboardFeatureListViewModel
        {
            CatalogExists = snapshot != null,
            Revision = snapshot?.Revision ?? string.Empty,
            Features = FilterFeatures(all, search, tag, category, sort),
            AllFeatures = all,
            ReadOnly = WritesUnavailable,
            Search = search ?? string.Empty,
            Tag = tag ?? string.Empty,
            Category = category ?? string.Empty,
            Sort = string.Equals(sort, "za", StringComparison.OrdinalIgnoreCase) ? "za" : "az",
            Expand = expand ?? string.Empty,
            Tags = all.SelectMany(feature => feature.Tags).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToList(),
            Categories = all.Select(feature => feature.Category).Where(value => !string.IsNullOrEmpty(value)).Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).Cast<string>().ToList(),
            UncategorizedCount = all.Count(feature => string.IsNullOrEmpty(feature.Category)),
            CopyCSharp = FeatureFlagsEnum.Generate(all),
            ConditionsDraft = draft,
            Lists = snapshot?.Document.Lists ?? []
        };
    }

    private ViewResult ValidationView(string viewName, DashboardFeatureInput input)
    {
        Response.StatusCode = StatusCodes.Status400BadRequest;
        return View(viewName, input);
    }

    private static List<CatalogFeature> FilterFeatures(IReadOnlyList<CatalogFeature> features, string? search, string? tag, string? category, string? sort)
    {
        IEnumerable<CatalogFeature> query = features;
        if (!string.IsNullOrWhiteSpace(search))
        {
            query = query.Where(feature =>
                feature.Name.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                feature.Key.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                (feature.Category ?? string.Empty).Contains(search, StringComparison.OrdinalIgnoreCase));
        }
        if (!string.IsNullOrWhiteSpace(tag)) query = query.Where(feature => feature.Tags.Contains(tag, StringComparer.OrdinalIgnoreCase));
        if (string.Equals(category, "__uncategorized", StringComparison.Ordinal))
            query = query.Where(feature => string.IsNullOrEmpty(feature.Category));
        else if (!string.IsNullOrWhiteSpace(category))
            query = query.Where(feature => string.Equals(feature.Category, category, StringComparison.Ordinal));
        var ordered = string.Equals(sort, "za", StringComparison.OrdinalIgnoreCase)
            ? query.OrderByDescending(feature => feature.Name, StringComparer.OrdinalIgnoreCase)
            : query.OrderBy(feature => feature.Name, StringComparer.OrdinalIgnoreCase);
        return ordered.ThenBy(feature => feature.Key, StringComparer.Ordinal).ToList();
    }

    private bool ApplyRuleEditorCommand(DashboardFeatureInput input, string? command, int? removeRuleIndex, string? newRuleName)
    {
        if (string.Equals(command, "add-entity", StringComparison.Ordinal))
        {
            input.Rules.Add(new DashboardRuleInput { Name = DashboardRuleInput.ContextProperty, ContextKind = input.ContextKind ?? string.Empty });
            ModelState.Clear();
            return true;
        }
        if (string.Equals(command, "turn-off", StringComparison.Ordinal))
        {
            input.Enabled = false;
            ModelState.Clear();
            return true;
        }
        if (string.Equals(command, "add-rule", StringComparison.Ordinal))
        {
            if (newRuleName == null || !DashboardRuleInput.UserFilterNames.ContainsKey(newRuleName))
            {
                ModelState.AddModelError("newRuleName", "Select a supported rule type.");
                Response.StatusCode = StatusCodes.Status400BadRequest;
                return true;
            }
            input.Rules.Add(new DashboardRuleInput { Name = newRuleName, Percentage = newRuleName == DashboardRuleInput.Targeting ? "0" : "100", ContextKind = input.ContextKind ?? string.Empty });
            ModelState.Clear();
            return true;
        }
        if (removeRuleIndex is >= 0 and < int.MaxValue && removeRuleIndex.Value < input.Rules.Count)
        {
            input.Rules.RemoveAt(removeRuleIndex.Value);
            ModelState.Clear();
            return true;
        }
        return false;
    }

    private static long MaximumBase64Length(long maximumBytes) => checked(((maximumBytes + 2) / 3) * 4);
}
