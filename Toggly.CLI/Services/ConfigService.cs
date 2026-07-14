using Toggly.CLI.Models;

namespace Toggly.CLI.Services;

/// <summary>
/// Resolves CLI auth configuration from command-line arguments and environment variables.
/// Secrets are never persisted to disk.
/// </summary>
public class ConfigService
{
    private static readonly string LegacyConfigDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".toggly");

    private static readonly string LegacyConfigFilePath = Path.Combine(LegacyConfigDirectory, "config.json");

    /// <summary>
    /// Load configuration from command-line arguments and environment variables.
    /// Priority: command-line arguments, then environment variables, then defaults for non-secret URLs.
    /// </summary>
    public TogglyConfig LoadConfig(
        string? clientId = null,
        string? clientSecret = null,
        string? authority = null,
        string? baseUrl = null)
    {
        // Best-effort cleanup of the deprecated on-disk credential store.
        RemoveLegacyConfigFile();

        var config = new TogglyConfig();

        if (string.IsNullOrEmpty(clientId))
            clientId = Environment.GetEnvironmentVariable("TOGGLY_CLIENT_ID");

        if (string.IsNullOrEmpty(clientSecret))
            clientSecret = Environment.GetEnvironmentVariable("TOGGLY_CLIENT_SECRET");

        if (string.IsNullOrEmpty(authority))
            authority = Environment.GetEnvironmentVariable("TOGGLY_AUTHORITY");

        if (string.IsNullOrEmpty(baseUrl))
            baseUrl = Environment.GetEnvironmentVariable("TOGGLY_BASE_URL");

        if (!string.IsNullOrEmpty(clientId))
            config.ClientId = clientId;

        if (!string.IsNullOrEmpty(clientSecret))
            config.ClientSecret = clientSecret;

        if (!string.IsNullOrEmpty(authority))
            config.Authority = authority;

        if (!string.IsNullOrEmpty(baseUrl))
            config.BaseUrl = baseUrl;

        if (string.IsNullOrEmpty(config.BaseUrl))
            config.BaseUrl = "https://app.toggly.io/api";

        if (string.IsNullOrEmpty(config.Authority) && !string.IsNullOrEmpty(config.ClientId))
            config.Authority = "https://auth.toggly.io";

        return config;
    }

    /// <summary>
    /// Validate that OAuth2 credentials are specified via CLI args or environment variables.
    /// </summary>
    public void ValidateAuthConfig(TogglyConfig config)
    {
        var hasOAuth2 = !string.IsNullOrEmpty(config.ClientId) && !string.IsNullOrEmpty(config.ClientSecret);

        if (!hasOAuth2)
        {
            throw new InvalidOperationException(
                "No authentication method specified. Provide --client-id and --client-secret, " +
                "or set TOGGLY_CLIENT_ID and TOGGLY_CLIENT_SECRET environment variables.");
        }
    }

    /// <summary>
    /// Deletes the deprecated <c>~/.toggly/config.json</c> (and empty <c>~/.toggly</c> directory)
    /// so plaintext client secrets are not left on disk.
    /// </summary>
    public static void RemoveLegacyConfigFile()
    {
        try
        {
            if (File.Exists(LegacyConfigFilePath))
                File.Delete(LegacyConfigFilePath);

            if (Directory.Exists(LegacyConfigDirectory) &&
                !Directory.EnumerateFileSystemEntries(LegacyConfigDirectory).Any())
            {
                Directory.Delete(LegacyConfigDirectory);
            }
        }
        catch
        {
            // Best effort — credentials may still be provided via CLI/env.
        }
    }
}
