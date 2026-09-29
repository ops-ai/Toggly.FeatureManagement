using System.Runtime.InteropServices;
using System.Text.Json;
using Toggly.CLI.Models;

namespace Toggly.CLI.Services;

/// <summary>
/// Persists non-secret CLI context preferences under the user config directory.
/// </summary>
public sealed class ContextStore
{
    private readonly string _directory;
    private readonly string _prefsPath;

    public ContextStore(string? configDirectory = null)
    {
        _directory = configDirectory ?? GetDefaultConfigDirectory();
        _prefsPath = Path.Combine(_directory, "prefs.json");
    }

    public string ConfigDirectory => _directory;

    public string PrefsPath => _prefsPath;

    public static string GetDefaultConfigDirectory()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "toggly");
        }

        var xdg = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME");
        if (!string.IsNullOrEmpty(xdg))
            return Path.Combine(xdg, "toggly");

        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".config",
            "toggly");
    }

    public ContextPrefs Load()
    {
        if (!File.Exists(_prefsPath))
            return new ContextPrefs();

        try
        {
            var json = File.ReadAllText(_prefsPath);
            return JsonSerializer.Deserialize(json, TogglyJsonSerializerContext.Default.ContextPrefs)
                   ?? new ContextPrefs();
        }
        catch (JsonException)
        {
            return new ContextPrefs();
        }
    }

    public void Save(ContextPrefs prefs)
    {
        Directory.CreateDirectory(_directory);
        var json = JsonSerializer.Serialize(prefs, TogglyJsonSerializerContext.Default.ContextPrefs);
        File.WriteAllText(_prefsPath, json);
    }

    public void Clear()
    {
        if (File.Exists(_prefsPath))
            File.Delete(_prefsPath);
    }

    /// <summary>
    /// Resolves application id from an explicit flag, then context prefs.
    /// </summary>
    public static bool TryResolveApplicationId(
        string? flagValue,
        ContextPrefs prefs,
        out string applicationId,
        out string errorMessage)
    {
        applicationId = string.Empty;
        errorMessage = string.Empty;

        if (!string.IsNullOrWhiteSpace(flagValue))
        {
            applicationId = flagValue.Trim();
            return true;
        }

        if (!string.IsNullOrWhiteSpace(prefs.DefaultApplicationId))
        {
            applicationId = prefs.DefaultApplicationId.Trim();
            return true;
        }

        errorMessage =
            "Application id required. Pass --app <id> or set a default with 'toggly context set --app <id>'.";
        return false;
    }

    /// <summary>
    /// Resolves environment name from an explicit flag, then context prefs.
    /// </summary>
    public static bool TryResolveEnvironment(
        string? flagValue,
        ContextPrefs prefs,
        out string environment,
        out string errorMessage)
    {
        environment = string.Empty;
        errorMessage = string.Empty;

        if (!string.IsNullOrWhiteSpace(flagValue))
        {
            environment = flagValue.Trim();
            return true;
        }

        if (!string.IsNullOrWhiteSpace(prefs.DefaultEnvironment))
        {
            environment = prefs.DefaultEnvironment.Trim();
            return true;
        }

        errorMessage =
            "Environment required. Pass --env <name> or set a default with 'toggly context set --env <name>'.";
        return false;
    }
}
