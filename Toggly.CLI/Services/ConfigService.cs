using System.Text.Json;
using Toggly.CLI.Models;
using Toggly.CLI;

namespace Toggly.CLI.Services;

/// <summary>
/// Service for managing configuration and credentials
/// </summary>
public class ConfigService
{
    private static readonly string ConfigDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".toggly");
    
    private static readonly string ConfigFilePath = Path.Combine(ConfigDirectory, "config.json");

    /// <summary>
    /// Load configuration from file, environment variables, and command-line arguments
    /// </summary>
    public TogglyConfig LoadConfig(
        string? clientId = null,
        string? clientSecret = null,
        string? authority = null,
        string? baseUrl = null)
    {
        var config = LoadFromFile();

        // Override with environment variables (lower priority than command-line)
        if (string.IsNullOrEmpty(clientId))
            clientId = Environment.GetEnvironmentVariable("TOGGLY_CLIENT_ID");
        
        if (string.IsNullOrEmpty(clientSecret))
            clientSecret = Environment.GetEnvironmentVariable("TOGGLY_CLIENT_SECRET");
        
        if (string.IsNullOrEmpty(authority))
            authority = Environment.GetEnvironmentVariable("TOGGLY_AUTHORITY");

        if (string.IsNullOrEmpty(baseUrl))
            baseUrl = Environment.GetEnvironmentVariable("TOGGLY_BASE_URL");

        // Override with command-line arguments (highest priority)
        if (!string.IsNullOrEmpty(clientId))
            config.ClientId = clientId;

        if (!string.IsNullOrEmpty(clientSecret))
            config.ClientSecret = clientSecret;

        if (!string.IsNullOrEmpty(authority))
            config.Authority = authority;

        if (!string.IsNullOrEmpty(baseUrl))
            config.BaseUrl = baseUrl;

        // Set defaults
        if (string.IsNullOrEmpty(config.BaseUrl))
            config.BaseUrl = "https://app.toggly.io/api";

        if (string.IsNullOrEmpty(config.Authority) && !string.IsNullOrEmpty(config.ClientId))
            config.Authority = "https://auth.toggly.io";

        return config;
    }

    /// <summary>
    /// Save configuration to file
    /// </summary>
    public void SaveConfig(TogglyConfig config)
    {
        if (!Directory.Exists(ConfigDirectory))
            Directory.CreateDirectory(ConfigDirectory);

        // Serialize with indentation for readability
        var options = new JsonSerializerOptions(TogglyJsonSerializerContext.Default.Options)
        {
            WriteIndented = true
        };
        var json = JsonSerializer.Serialize(config, typeof(TogglyConfig), new TogglyJsonSerializerContext(options));
        File.WriteAllText(ConfigFilePath, json);
    }

    /// <summary>
    /// Validate that OAuth2 credentials are specified
    /// </summary>
    public void ValidateAuthConfig(TogglyConfig config)
    {
        var hasOAuth2 = !string.IsNullOrEmpty(config.ClientId) && !string.IsNullOrEmpty(config.ClientSecret);

        if (!hasOAuth2)
            throw new InvalidOperationException("No authentication method specified. Please provide --client-id and --client-secret.");
    }

    private TogglyConfig LoadFromFile()
    {
        if (!File.Exists(ConfigFilePath))
            return new TogglyConfig();

        try
        {
            var json = File.ReadAllText(ConfigFilePath);
            var config = JsonSerializer.Deserialize<TogglyConfig>(json, TogglyJsonSerializerContext.Default.TogglyConfig);
            return config ?? new TogglyConfig();
        }
        catch (JsonException)
        {
            // If config file is invalid, return default config
            return new TogglyConfig();
        }
    }
}

