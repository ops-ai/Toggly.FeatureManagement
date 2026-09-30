using System.CommandLine;
using System.Text.Json;
using Toggly.CLI;
using Xunit;

namespace Toggly.CLI.Tests.Docs;

/// <summary>
/// Ensures <c>Docs/command-catalog.json</c> documents every RootCommand leaf
/// (noun subcommands and flat write aliases).
/// </summary>
public class CommandCatalogTests
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    [Fact]
    public void Catalog_CoversEveryRootCommandLeaf()
    {
        var catalog = LoadCatalog();
        var catalogPaths = catalog.Commands
            .Select(c => string.Join(' ', c.Path))
            .ToHashSet(StringComparer.Ordinal);

        var root = CliApplication.CreateRootCommand(_ => null!);
        var missing = EnumerateLeafPaths(root)
            .Where(path => !catalogPaths.Contains(path))
            .OrderBy(p => p, StringComparer.Ordinal)
            .ToList();

        Assert.True(
            missing.Count == 0,
            "command-catalog.json is missing RootCommand leaves:\n- " + string.Join("\n- ", missing));
    }

    [Fact]
    public void Catalog_LeafPaths_AreUnique()
    {
        var catalog = LoadCatalog();
        var paths = catalog.Commands.Select(c => string.Join(' ', c.Path)).ToList();
        Assert.Equal(paths.Count, paths.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Catalog_DeclaresGlobalsAndExitCodes()
    {
        var catalog = LoadCatalog();
        Assert.Contains(catalog.Globals, g => g.Name == "--json");
        Assert.Contains(catalog.Globals, g => g.Name == "--client-id");
        Assert.Contains(catalog.ExitCodes, e => e.Code == 0);
        Assert.Contains(catalog.ExitCodes, e => e.Code == 2);
        Assert.False(string.IsNullOrWhiteSpace(catalog.DocsUrl));
    }

    [Fact]
    public void GeneratedManPages_ExistForRootAndNounGroups()
    {
        var manDir = ResolveManDir();
        Assert.True(Directory.Exists(manDir), $"Missing man directory at {manDir}");

        foreach (var page in new[]
                 {
                     "toggly.1",
                     "toggly-auth.1",
                     "toggly-app.1",
                     "toggly-env.1",
                     "toggly-feature.1",
                     "toggly-release.1",
                     "toggly-context.1"
                 })
        {
            var path = Path.Combine(manDir, page);
            Assert.True(File.Exists(path), $"Missing man page {path}");
            var text = File.ReadAllText(path);
            Assert.Contains(".TH ", text);
            Assert.Contains("Generated from Docs/command-catalog.json", text);
        }
    }

    private static IEnumerable<string> EnumerateLeafPaths(Command command, string prefix = "")
    {
        var subcommands = command.Subcommands.ToList();
        if (subcommands.Count == 0)
        {
            if (!string.IsNullOrEmpty(prefix))
                yield return prefix;
            yield break;
        }

        foreach (var child in subcommands)
        {
            var next = string.IsNullOrEmpty(prefix) ? child.Name : $"{prefix} {child.Name}";
            foreach (var leaf in EnumerateLeafPaths(child, next))
                yield return leaf;
        }
    }

    private static CommandCatalog LoadCatalog()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Docs", "command-catalog.json");
        Assert.True(File.Exists(path), $"Missing command catalog at {path}");
        var catalog = JsonSerializer.Deserialize<CommandCatalog>(File.ReadAllText(path), JsonOptions);
        Assert.NotNull(catalog);
        Assert.NotEmpty(catalog.Commands);
        return catalog;
    }

    private static string ResolveManDir()
    {
        var fromOutput = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "Toggly.CLI", "man"));
        if (Directory.Exists(fromOutput))
            return fromOutput;

        // Fallback when tests run from a different layout.
        var cwd = Directory.GetCurrentDirectory();
        var candidate = Path.Combine(cwd, "Toggly.CLI", "man");
        if (Directory.Exists(candidate))
            return candidate;

        return Path.Combine(cwd, "man");
    }

    private sealed class CommandCatalog
    {
        public string DocsUrl { get; set; } = "";
        public List<NamedItem> Globals { get; set; } = [];
        public List<ExitCodeItem> ExitCodes { get; set; } = [];
        public List<CatalogCommand> Commands { get; set; } = [];
    }

    private sealed class CatalogCommand
    {
        public List<string> Path { get; set; } = [];
    }

    private sealed class NamedItem
    {
        public string Name { get; set; } = "";
    }

    private sealed class ExitCodeItem
    {
        public int Code { get; set; }
    }
}
