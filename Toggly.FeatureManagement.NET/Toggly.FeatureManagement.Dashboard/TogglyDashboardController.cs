using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Embedded;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Server-rendered feature catalog pages for one embedded application.</summary>
[ServiceFilter(typeof(TogglyDashboardAccessFilter))]
public sealed class TogglyDashboardController : Controller
{
    private readonly EmbeddedCatalogEditor _editor;
    private readonly EmbeddedCatalogCoordinator _coordinator;

    /// <summary>Creates the dashboard controller.</summary>
    public TogglyDashboardController(EmbeddedCatalogEditor editor, EmbeddedCatalogCoordinator coordinator)
    {
        _editor = editor;
        _coordinator = coordinator;
    }

    /// <summary>Lists the catalog features.</summary>
    public async Task<IActionResult> Index()
    {
        try
        {
            var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
            return View(new DashboardFeatureListViewModel
            {
                CatalogExists = snapshot != null,
                Revision = snapshot?.Revision ?? string.Empty,
                Features = snapshot?.Document.Features.OrderBy(feature => feature.Name, StringComparer.OrdinalIgnoreCase).ThenBy(feature => feature.Key, StringComparer.Ordinal).ToList() ?? [],
                ReadOnly = _coordinator.Diagnostics.ReadOnly
            });
        }
        catch (Exception)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, "Catalog storage is unavailable.");
        }
    }

    /// <summary>Shows a disabled-feature creation form.</summary>
    public IActionResult New() => View(new DashboardFeatureInput { ExpectedRevision = string.Empty });

    /// <summary>Creates a disabled feature when the catalog has not changed.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(DashboardFeatureInput input)
    {
        input.Enabled = false;
        var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
        if (snapshot == null) return NotFound();
        input.ExpectedRevision = snapshot.Revision;
        if (!ModelState.IsValid) return BadRequest(View("New", input));
        if (snapshot.Document.Features.Any(feature => string.Equals(feature.Key, input.Key.Trim(), StringComparison.OrdinalIgnoreCase)))
        {
            ModelState.AddModelError(nameof(input.Key), "A feature with this key already exists.");
            return BadRequest(View("New", input));
        }

        snapshot.Document.Features.Add(input.ToFeature());
        return await WriteOrConflictAsync(snapshot.Document, snapshot.Revision, "Index", input).ConfigureAwait(false);
    }

    /// <summary>Shows the editor for an existing feature.</summary>
    public async Task<IActionResult> Edit(string key)
    {
        var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
        var feature = snapshot?.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, key, StringComparison.Ordinal));
        return feature == null || snapshot == null ? NotFound() : View(DashboardFeatureInput.FromFeature(feature, snapshot.Revision));
    }

    /// <summary>Saves editable metadata while preserving retained targeting rules.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Save(DashboardFeatureInput input)
    {
        if (!ModelState.IsValid) return BadRequest(View("Edit", input));
        var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
        var existing = snapshot?.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, input.Key, StringComparison.Ordinal));
        if (snapshot == null || existing == null) return NotFound();
        snapshot.Document.Features[snapshot.Document.Features.IndexOf(existing)] = input.ToFeature(existing);
        return await WriteOrConflictAsync(snapshot.Document, input.ExpectedRevision, "Edit", input).ConfigureAwait(false);
    }

    /// <summary>Sets an explicit enabled state without deleting rules.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> State(string key, bool enabled, string expectedRevision)
    {
        var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
        var feature = snapshot?.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, key, StringComparison.Ordinal));
        if (snapshot == null || feature == null) return NotFound();
        feature.Enabled = enabled;
        return await WriteOrConflictAsync(snapshot.Document, expectedRevision, "Index", null).ConfigureAwait(false);
    }

    /// <summary>Shows a destructive-action confirmation page.</summary>
    public async Task<IActionResult> DeleteConfirm(string key)
    {
        var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
        var feature = snapshot?.Document.Features.SingleOrDefault(candidate => string.Equals(candidate.Key, key, StringComparison.Ordinal));
        if (snapshot == null || feature == null) return NotFound();
        return View(DashboardFeatureInput.FromFeature(feature, snapshot.Revision));
    }

    /// <summary>Deletes a feature after confirmation.</summary>
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Delete(string key, string expectedRevision)
    {
        var snapshot = await _editor.ReadAsync(HttpContext.RequestAborted).ConfigureAwait(false);
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

    public override void OnActionExecuting(Microsoft.AspNetCore.Mvc.Filters.ActionExecutingContext context)
    {
        var metadata = context.HttpContext.GetEndpoint()?.Metadata.GetMetadata<TogglyDashboardEndpointMetadata>();
        ViewData["DashboardMount"] = metadata?.MountPath ?? string.Empty;
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
}
