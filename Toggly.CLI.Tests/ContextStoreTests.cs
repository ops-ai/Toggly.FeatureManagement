using System.CommandLine;
using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class ContextStoreTests
{
    [Fact]
    public void SaveLoadClear_RoundTripsNonSecretPrefs()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "toggly-cli-prefs-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        try
        {
            var store = new ContextStore(tempDir);
            store.Save(new ContextPrefs
            {
                DefaultApplicationId = "app-1",
                DefaultEnvironment = "Production"
            });

            Assert.True(File.Exists(store.PrefsPath));
            var loaded = store.Load();
            Assert.Equal("app-1", loaded.DefaultApplicationId);
            Assert.Equal("Production", loaded.DefaultEnvironment);

            store.Clear();
            Assert.False(File.Exists(store.PrefsPath));
            var cleared = store.Load();
            Assert.Null(cleared.DefaultApplicationId);
            Assert.Null(cleared.DefaultEnvironment);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public void TryResolveApplicationId_PrefersFlagThenPrefs()
    {
        var prefs = new ContextPrefs { DefaultApplicationId = "from-prefs" };
        Assert.True(ContextStore.TryResolveApplicationId("from-flag", prefs, out var id, out _));
        Assert.Equal("from-flag", id);

        Assert.True(ContextStore.TryResolveApplicationId(null, prefs, out id, out _));
        Assert.Equal("from-prefs", id);

        Assert.False(ContextStore.TryResolveApplicationId(null, new ContextPrefs(), out _, out var error));
        Assert.Contains("--app", error);
    }

    [Fact]
    public void TryResolveEnvironment_PrefersFlagThenPrefs()
    {
        var prefs = new ContextPrefs { DefaultEnvironment = "Production" };
        Assert.True(ContextStore.TryResolveEnvironment("Staging", prefs, out var env, out _));
        Assert.Equal("Staging", env);
        Assert.True(ContextStore.TryResolveEnvironment(null, prefs, out env, out _));
        Assert.Equal("Production", env);
        Assert.False(ContextStore.TryResolveEnvironment(null, new ContextPrefs(), out _, out var error));
        Assert.Contains("--env", error);
    }

    [Fact]
    public void Load_CorruptJson_ReturnsEmptyPrefs()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "toggly-cli-corrupt-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        try
        {
            var store = new ContextStore(tempDir);
            File.WriteAllText(store.PrefsPath, "{not-json");
            var prefs = store.Load();
            Assert.Null(prefs.DefaultApplicationId);
            Assert.Null(prefs.DefaultEnvironment);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public void Save_WhenPathIsFile_ThrowsInvalidOperationException()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "toggly-cli-io-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var blocked = Path.Combine(tempDir, "blocked-as-file");
        File.WriteAllText(blocked, "not-a-directory");
        try
        {
            var store = new ContextStore(blocked);
            var ex = Assert.Throws<InvalidOperationException>(() =>
                store.Save(new ContextPrefs { DefaultApplicationId = "app-1" }));
            Assert.Contains("Cannot write context preferences", ex.Message);
            Assert.NotNull(ex.InnerException);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public void Load_WhenPrefsPathIsDirectory_ThrowsInvalidOperationException()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "toggly-cli-loaddir-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        Directory.CreateDirectory(Path.Combine(tempDir, "prefs.json"));
        try
        {
            var store = new ContextStore(tempDir);
            var ex = Assert.Throws<InvalidOperationException>(() => store.Load());
            Assert.Contains("Cannot read context preferences", ex.Message);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public void Clear_WhenPrefsPathIsDirectory_ThrowsInvalidOperationException()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "toggly-cli-cleardir-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        Directory.CreateDirectory(Path.Combine(tempDir, "prefs.json"));
        try
        {
            var store = new ContextStore(tempDir);
            var ex = Assert.Throws<InvalidOperationException>(() => store.Clear());
            Assert.Contains("Cannot clear context preferences", ex.Message);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public async Task ContextCommands_SetGetClear_PersistUnderConfiguredDir()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "toggly-cli-context-cmd-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        try
        {
            var command = CliApplication.CreateRootCommand(
                _ => null!,
                contextStoreFactory: () => new ContextStore(tempDir));

            Assert.Equal(0, await command.InvokeAsync(["context", "set", "--app", "app-9", "--env", "Staging"]));
            var prefs = new ContextStore(tempDir).Load();
            Assert.Equal("app-9", prefs.DefaultApplicationId);
            Assert.Equal("Staging", prefs.DefaultEnvironment);

            Assert.Equal(0, await command.InvokeAsync(["context", "clear"]));
            prefs = new ContextStore(tempDir).Load();
            Assert.Null(prefs.DefaultApplicationId);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public async Task ContextSet_IoFailure_ReturnsExitCode1()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "toggly-cli-ctx-fail-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var blocked = Path.Combine(tempDir, "blocked");
        File.WriteAllText(blocked, "x");
        try
        {
            var stderr = new StringWriter();
            var command = CliApplication.CreateRootCommand(
                _ => null!,
                contextStoreFactory: () => new ContextStore(blocked),
                errorWriter: stderr);

            Assert.Equal(1, await command.InvokeAsync(["context", "set", "--app", "app-1"]));
            Assert.Contains("Cannot write context preferences", stderr.ToString());
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }
}
