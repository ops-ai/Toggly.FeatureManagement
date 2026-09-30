using System.CommandLine;
using System.Diagnostics;
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

        foreach (var page in RequiredManPages)
        {
            var path = Path.Combine(manDir, page);
            Assert.True(File.Exists(path), $"Missing man page {path}");
            var text = File.ReadAllText(path);
            Assert.Contains(".TH ", text);
            Assert.Contains("Generated from Docs/command-catalog.json", text);
        }
    }

    [Fact]
    public void GeneratedManPages_HaveRequiredSectionsAndNoBareEllipsis()
    {
        var manDir = ResolveManDir();
        Assert.True(Directory.Exists(manDir), $"Missing man directory at {manDir}");

        string[] requiredSections =
        [
            ".SH NAME",
            ".SH SYNOPSIS",
            ".SH DESCRIPTION",
            ".SH OPTIONS",
            ".SH EXAMPLES",
            ".SH EXIT STATUS",
            ".SH SEE ALSO"
        ];

        foreach (var page in RequiredManPages)
        {
            var path = Path.Combine(manDir, page);
            var lines = File.ReadAllLines(path);
            var text = string.Join('\n', lines);

            foreach (var section in requiredSections)
                Assert.Contains(section, text);

            // Bare "..." is parsed as an unknown mandoc macro (ERROR).
            var bareEllipsis = lines.Where(static line => line.Trim() == "...").ToList();
            Assert.True(
                bareEllipsis.Count == 0,
                $"Man page {page} has a bare ellipsis line; use \\&...");
        }

        var root = File.ReadAllText(Path.Combine(manDir, "toggly.1"));
        Assert.Contains("\\&...", root);
    }

    /// <summary>
    /// Merge-blocking: committed <c>man/*.1</c> must match generator output from the catalog.
    /// </summary>
    [Fact]
    public void GenerateManpages_Check_MatchesCommittedManPages()
    {
        var cliRoot = ResolveCliRoot();
        var script = Path.Combine(cliRoot, "scripts", "generate-manpages.py");
        Assert.True(File.Exists(script), $"Missing generator script at {script}");

        var python = ResolvePython3();
        Assert.False(
            string.IsNullOrEmpty(python),
            "python3 (or Python 3 via 'python') is required to verify man page drift");

        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = python,
                // --check: drift vs committed man/; --lint: mandoc -Tlint when installed (no-op skip otherwise)
                ArgumentList = { script, "--check", "--lint" },
                WorkingDirectory = cliRoot,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            }
        };

        process.Start();
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        var exited = process.WaitForExit(60_000);
        Assert.True(exited, "generate-manpages.py --check --lint timed out after 60s");
        Assert.True(
            process.ExitCode == 0,
            $"generate-manpages.py --check --lint failed (exit {process.ExitCode}). "
            + "Regenerate with ./Toggly.CLI/scripts/generate-manpages.py and commit man/.\n"
            + $"stdout:\n{stdout}\nstderr:\n{stderr}");
    }

    private static readonly string[] RequiredManPages =
    [
        "toggly.1",
        "toggly-auth.1",
        "toggly-app.1",
        "toggly-env.1",
        "toggly-feature.1",
        "toggly-release.1",
        "toggly-context.1"
    ];

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

    private static string ResolveCliRoot()
    {
        var fromOutput = Path.GetFullPath(
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "Toggly.CLI"));
        if (Directory.Exists(Path.Combine(fromOutput, "scripts"))
            && File.Exists(Path.Combine(fromOutput, "Docs", "command-catalog.json")))
            return fromOutput;

        var cwd = Directory.GetCurrentDirectory();
        var candidate = Path.Combine(cwd, "Toggly.CLI");
        if (Directory.Exists(Path.Combine(candidate, "scripts")))
            return candidate;

        if (Directory.Exists(Path.Combine(cwd, "scripts"))
            && File.Exists(Path.Combine(cwd, "Docs", "command-catalog.json")))
            return cwd;

        return fromOutput;
    }

    private static string ResolveManDir() => Path.Combine(ResolveCliRoot(), "man");

    private static string? ResolvePython3()
    {
        foreach (var candidate in new[] { "python3", "python" })
        {
            try
            {
                using var probe = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = candidate,
                        ArgumentList = { "--version" },
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false
                    }
                };
                probe.Start();
                var output = probe.StandardOutput.ReadToEnd() + probe.StandardError.ReadToEnd();
                if (!probe.WaitForExit(5_000))
                    continue;
                if (probe.ExitCode == 0
                    && output.Contains("Python 3", StringComparison.Ordinal))
                    return candidate;
            }
            catch (Exception)
            {
                // Try the next candidate (missing binary, PATH, etc.).
            }
        }

        return null;
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
