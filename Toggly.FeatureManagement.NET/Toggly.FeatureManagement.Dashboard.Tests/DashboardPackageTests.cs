using System.Diagnostics;
using System.IO.Compression;
using FluentAssertions;
using Xunit;

namespace Toggly.FeatureManagement.Dashboard.Tests;

public sealed class DashboardPackageTests
{
    [Fact]
    public async Task Packing_after_coverage_keeps_generated_reports_out_of_the_package()
    {
        var sdkRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../.."));
        var project = Path.Combine(sdkRoot, "Toggly.FeatureManagement.Dashboard");
        var generated = Path.Combine(project, "coverage", "tmp", Guid.NewGuid().ToString("N"));
        var output = Path.Combine(Path.GetTempPath(), "toggly-dashboard-pack-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(generated);
        Directory.CreateDirectory(output);
        try
        {
            await File.WriteAllTextAsync(Path.Combine(generated, "coverage.json"), "{\"result\":[]}");
            var start = new ProcessStartInfo("dotnet")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                WorkingDirectory = sdkRoot
            };
            start.Environment["MSBUILDDISABLENODEREUSE"] = "1";
            foreach (var argument in new[] { "pack", Path.Combine(project, "Toggly.FeatureManagement.Dashboard.csproj"),
                         "-c", "Release", "--no-build", "--no-restore", "-o", output })
                start.ArgumentList.Add(argument);
            using var process = Process.Start(start)!;
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(2));
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync();
                throw;
            }
            process.ExitCode.Should().Be(0, "packing must succeed: {0} {1}", await stdout, await stderr);

            using var package = ZipFile.OpenRead(Directory.GetFiles(output, "*.nupkg").Single());
            package.Entries.Should().NotContain(entry => entry.FullName.Split('/', StringSplitOptions.None).Contains("coverage"));
            package.Entries.Should().Contain(entry => entry.FullName.EndsWith("/Toggly.FeatureManagement.Dashboard.dll"));
            package.Entries.Should().Contain(entry => entry.FullName == "README.md");
        }
        finally
        {
            try { Directory.Delete(generated, recursive: true); }
            finally { Directory.Delete(output, recursive: true); }
        }
    }
}
