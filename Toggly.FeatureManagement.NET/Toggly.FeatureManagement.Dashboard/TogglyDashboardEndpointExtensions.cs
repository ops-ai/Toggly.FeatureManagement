using System.Reflection;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Constraints;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Maps the fixed, authorization-aware embedded dashboard endpoints.</summary>
public static class TogglyDashboardEndpointExtensions
{
    /// <summary>Maps one dashboard mount and returns an aggregate endpoint convention builder for host authorization.</summary>
    public static IEndpointConventionBuilder MapTogglyDashboard(this IEndpointRouteBuilder endpoints, string pattern = "/toggly", TogglyDashboardOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(endpoints);
        var mount = NormalizeMount(pattern);
        var group = endpoints.MapGroup(mount);
        group.WithMetadata(new TogglyDashboardEndpointMetadata(mount));
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

        group.MapGet("assets/{knownName}", async (HttpContext context, string knownName) =>
        {
            if (!TogglyDashboardAccess.IsAllowed(context, context.GetEndpoint()!)) return Results.StatusCode(StatusCodes.Status403Forbidden);
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
