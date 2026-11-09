#nullable enable

using System.IO;

namespace Toggly.FeatureManagement.Parity.Tests;

internal static class SharedFixturePaths
{
    public static string? ResolveRepoRoot()
    {
        var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        for (var i = 0; i < 8 && dir != null; i++)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "docs", "filter-parity", "fixtures")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        dir = new DirectoryInfo(System.AppContext.BaseDirectory);
        for (var i = 0; i < 10 && dir != null; i++)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "docs", "filter-parity", "fixtures")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        return null;
    }

    public static string ResolveFilterParityFixturesDir()
    {
        var root = ResolveRepoRoot()
            ?? throw new DirectoryNotFoundException("Could not locate docs/filter-parity/fixtures from the test host.");
        return Path.Combine(root, "docs", "filter-parity", "fixtures");
    }
}
