using System.Text.Json;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests.Contract;

/// <summary>
/// Merge-blocking drift check: <see cref="CliApiRoutes.Curated"/> must match
/// <c>Contracts/cli-ops-routes.json</c>.
/// </summary>
public class OpenApiOpsSubsetDriftTests
{
    [Fact]
    public void CuratedRoutes_MatchCheckedInOpsSubset()
    {
        var subsetPath = Path.Combine(AppContext.BaseDirectory, "Contracts", "cli-ops-routes.json");
        Assert.True(File.Exists(subsetPath), $"Missing ops subset at {subsetPath}");

        using var document = JsonDocument.Parse(File.ReadAllText(subsetPath));
        var fileRoutes = document.RootElement.GetProperty("routes").EnumerateArray()
            .Select(ParseRoute)
            .OrderBy(r => r.Id, StringComparer.Ordinal)
            .ToList();

        var codeRoutes = CliApiRoutes.Curated
            .Select(r => new RouteKey(r.Id, r.Method, r.PathTemplate, r.Command))
            .OrderBy(r => r.Id, StringComparer.Ordinal)
            .ToList();

        Assert.Equal(codeRoutes.Count, fileRoutes.Count);
        Assert.Equal(codeRoutes, fileRoutes);
    }

    [Fact]
    public void CuratedRouteIds_AreUnique()
    {
        var ids = CliApiRoutes.Curated.Select(r => r.Id).ToList();
        Assert.Equal(ids.Count, ids.Distinct(StringComparer.Ordinal).Count());
    }

    private static RouteKey ParseRoute(JsonElement element) =>
        new(
            element.GetProperty("id").GetString()!,
            element.GetProperty("method").GetString()!,
            element.GetProperty("pathTemplate").GetString()!,
            element.GetProperty("command").GetString()!);

    private sealed record RouteKey(string Id, string Method, string PathTemplate, string Command);
}
