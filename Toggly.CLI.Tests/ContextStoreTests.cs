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
}
