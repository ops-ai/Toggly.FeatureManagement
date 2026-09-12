using System.Reflection;
using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Constraints;
using Microsoft.Extensions.Hosting;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Maps the fixed, authorization-aware embedded dashboard endpoints.</summary>
public static class TogglyDashboardEndpointExtensions
{
    private static readonly ConditionalWeakTable<IEndpointRouteBuilder, object> MountedHosts = new();
    /// <summary>Maps one dashboard mount and returns an aggregate endpoint convention builder for host authorization.</summary>
    public static IEndpointConventionBuilder MapTogglyDashboard(this IEndpointRouteBuilder endpoints, string pattern = "/toggly", TogglyDashboardOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(endpoints);
        var mount = NormalizeMount(pattern);
        lock (MountedHosts)
        {
            if (MountedHosts.TryGetValue(endpoints, out _)) throw new InvalidOperationException("Only one Toggly dashboard mount is supported per host.");
            MountedHosts.Add(endpoints, new object());
        }
        var applicationName = options?.ApplicationName;
        if (string.IsNullOrWhiteSpace(applicationName)) applicationName = (endpoints.ServiceProvider.GetService(typeof(IHostEnvironment)) as IHostEnvironment)?.ApplicationName ?? "Application";
        var group = endpoints.MapGroup(mount);
        group.WithMetadata(new TogglyDashboardEndpointMetadata(mount, applicationName));
        group.WithDisplayName("Toggly Embedded Dashboard");

        MapController(group, "index", "", "Index", HttpMethods.Get);
        MapController(group, "new", "features/new", "New", HttpMethods.Get);
        MapController(group, "create", "features/create", "Create", HttpMethods.Post);
        MapController(group, "edit", "features/edit", "Edit", HttpMethods.Get);
        MapController(group, "save", "features/save", "Save", HttpMethods.Post);
        MapController(group, "state", "features/state", "State", HttpMethods.Post);
        MapController(group, "delete-confirm", "features/delete", "DeleteConfirm", HttpMethods.Get);
        MapController(group, "delete", "features/delete", "Delete", HttpMethods.Post);
        MapController(group, "initialize", "initialize", "Initialize", HttpMethods.Post);
        MapController(group, "contexts", "contexts", "Contexts", HttpMethods.Get);
        MapController(group, "storage", "storage", "Storage", HttpMethods.Get);
        MapController(group, "export", "export", "Export", HttpMethods.Get);
        MapController(group, "import", "import", "Import", HttpMethods.Get);
        MapController(group, "import-preview", "import/preview", "ImportPreview", HttpMethods.Post);
        MapController(group, "import-apply", "import/apply", "ImportApply", HttpMethods.Post);
        MapController(group, "cloud", "cloud", "Cloud", HttpMethods.Get);

        group.MapGet("assets/{knownName}", async (HttpContext context, string knownName) =>
        {
            if (!TogglyDashboardAccess.IsAllowed(context, context.GetEndpoint()!)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            context.Response.Headers.CacheControl = "private, no-store";
            return await DashboardAssets.GetAsync(knownName).ConfigureAwait(false);
        }).WithDisplayName("Toggly Dashboard assets");

        return group;
    }

    private static void MapController(RouteGroupBuilder group, string routeName, string pattern, string action, string method)
    {
        group.MapControllerRoute(
            "TogglyDashboard." + routeName,
            pattern,
            new { controller = "TogglyDashboard", action },
            new { httpMethod = new HttpMethodRouteConstraint(method) });
    }

    private static string NormalizeMount(string pattern)
    {
        if (string.IsNullOrWhiteSpace(pattern)) throw new ArgumentException("Dashboard mount path is required.", nameof(pattern));
        var trimmed = pattern.Trim();
        if (!trimmed.StartsWith("/", StringComparison.Ordinal)) trimmed = "/" + trimmed;
        trimmed = trimmed.TrimEnd('/');
        if (trimmed.Length == 0) throw new ArgumentException("The dashboard cannot be mounted at the application root.", nameof(pattern));
        if (trimmed.IndexOfAny(new[] { '{', '}', '*', '?' }) >= 0) throw new ArgumentException("Dashboard mount paths cannot contain route parameters or wildcards.", nameof(pattern));
        return trimmed;
    }
}

internal static class DashboardAssets
{
    private static readonly Assembly Assembly = typeof(DashboardAssets).Assembly;
    private static readonly IReadOnlyDictionary<string, string> Names = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["dashboard.css"] = "Toggly.FeatureManagement.Dashboard.Assets.dashboard.css",
        ["dashboard.js"] = "Toggly.FeatureManagement.Dashboard.Assets.dashboard.js"
    };

    internal static async Task<IResult> GetAsync(string name)
    {
        if (!Names.TryGetValue(name, out var resource)) return Results.NotFound();
        await using var stream = Assembly.GetManifestResourceStream(resource);
        if (stream == null) return Results.NotFound();
        using var memory = new MemoryStream();
        await stream.CopyToAsync(memory).ConfigureAwait(false);
        var contentType = name.EndsWith(".css", StringComparison.Ordinal) ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
        return Results.File(memory.ToArray(), contentType, enableRangeProcessing: false, lastModified: null, entityTag: null, fileDownloadName: null);
    }
}
