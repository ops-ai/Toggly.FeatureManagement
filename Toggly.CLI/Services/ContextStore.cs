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
        try
        {
            if (Directory.Exists(_prefsPath))
                throw new IOException($"'{_prefsPath}' is a directory, expected a preferences file.");

            if (!File.Exists(_prefsPath))
                return new ContextPrefs();

            var json = File.ReadAllText(_prefsPath);
            return JsonSerializer.Deserialize(json, TogglyJsonSerializerContext.Default.ContextPrefs)
                   ?? new ContextPrefs();
        }
        catch (JsonException)
        {
            return new ContextPrefs();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw WrapIo(ex, "read");
        }
    }

    public void Save(ContextPrefs prefs)
    {
        try
        {
            Directory.CreateDirectory(_directory);
            var json = JsonSerializer.Serialize(prefs, TogglyJsonSerializerContext.Default.ContextPrefs);
            File.WriteAllText(_prefsPath, json);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw WrapIo(ex, "write");
        }
    }

    public void Clear()
    {
        try
        {
            if (Directory.Exists(_prefsPath))
                throw new IOException($"'{_prefsPath}' is a directory, expected a preferences file.");

            if (File.Exists(_prefsPath))
                File.Delete(_prefsPath);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw WrapIo(ex, "clear");
        }
    }

    /// <summary>
    /// Resolves a required value from an explicit flag, then a stored preference.
    /// </summary>
    public static bool TryResolveRequired(
        string? flagValue,
        string? preferenceValue,
        string missingMessage,
        out string value,
        out string errorMessage)
    {
        value = string.Empty;
        errorMessage = string.Empty;

        if (!string.IsNullOrWhiteSpace(flagValue))
        {
            value = flagValue.Trim();
            return true;
        }

        if (!string.IsNullOrWhiteSpace(preferenceValue))
        {
            value = preferenceValue.Trim();
            return true;
        }

        errorMessage = missingMessage;
        return false;
    }

    /// <summary>
    /// Resolves application id from an explicit flag, then context prefs.
    /// </summary>
    public static bool TryResolveApplicationId(
        string? flagValue,
        ContextPrefs prefs,
        out string applicationId,
        out string errorMessage) =>
        TryResolveRequired(
            flagValue,
            prefs.DefaultApplicationId,
            "Application id required. Pass --app <id> or set a default with 'toggly context set --app <id>'.",
            out applicationId,
            out errorMessage);

    /// <summary>
    /// Resolves environment name from an explicit flag, then context prefs.
    /// </summary>
    public static bool TryResolveEnvironment(
        string? flagValue,
        ContextPrefs prefs,
        out string environment,
        out string errorMessage) =>
        TryResolveRequired(
            flagValue,
            prefs.DefaultEnvironment,
            "Environment required. Pass --env <name> or set a default with 'toggly context set --env <name>'.",
            out environment,
            out errorMessage);

    private InvalidOperationException WrapIo(Exception ex, string action) =>
        new(
            $"Cannot {action} context preferences at '{_prefsPath}'. Check permissions and disk space. {ex.Message}",
            ex);
}
